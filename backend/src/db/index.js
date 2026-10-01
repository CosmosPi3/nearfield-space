const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// Truncate any WAL backlog left over from a previous run (e.g. an unclean
// shutdown) so it doesn't keep growing indefinitely, and relax fsync
// durability one notch — still safe under WAL mode (a crash can lose the
// last commit but never corrupts the db) and meaningfully cheaper per-write
// on slower/cloud block storage than the default `FULL`.
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('synchronous = NORMAL');
// The schema's REFERENCES clauses are documentation only, not enforced —
// workspace_nodes must be insertable before a matching tracks row necessarily
// exists (a node is persisted the instant it's added client-side, well
// before extraction/caching completes). foreign_keys defaults to ON in this
// SQLite build, so it must be explicitly turned off.
db.pragma('foreign_keys = OFF');

// One-time migration: workspace_nodes/workspace_discoveries predate account
// scoping (they used to key on an anonymous device_id), and SQLite can't
// ALTER a PRIMARY KEY, so an already-existing DB file's old-shape tables must
// be dropped before schema.sql (below) recreates them with user_id in the PK
// -- schema.sql's own backfill INSERT assumes that column already exists, so
// this must run first. Existing workspace data is intentionally discarded
// here -- there is no user identity to attribute anonymous device-scoped rows
// to. Idempotent: a fresh or already-migrated DB has no old-shape table to
// drop (table_info on a nonexistent table just returns []).
const workspaceCols = db.prepare(`PRAGMA table_info(workspace_nodes)`).all();
if (workspaceCols.length && !workspaceCols.some((c) => c.name === 'user_id')) {
  db.exec('DROP TABLE IF EXISTS workspace_discoveries');
  db.exec('DROP TABLE IF EXISTS workspace_nodes');
}

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — this guard is
// what makes adding a column to an already-existing DB file idempotent
// across boots, the same way schema.sql's CREATE TABLE IF NOT EXISTS is.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn('tracks', 'raw_tempo_bpm', 'REAL');
ensureColumn('tracks', 'discovered_by_user_id', 'INTEGER');

const stmts = {
  getById: db.prepare('SELECT * FROM tracks WHERE id = ?'),
  // discovered_by_user_id is intentionally absent from the DO UPDATE SET
  // clause below -- present only in the INSERT column list, so it's set
  // once on a row's first-ever insert and never touched again on later
  // re-extractions/updates of the same track. See schema.sql's comment.
  upsert: db.prepare(`
    INSERT INTO tracks (
      id, name, artist, track, video_id, external_link, source, view_count,
      extraction_status, last_error,
      spectral_centroid_mean, spectral_flatness_mean, tempo_bpm, raw_tempo_bpm, rms_mean, rms_var, energy_valence,
      features_json, vector_json, extracted_at, updated_at, discovered_by_user_id
    ) VALUES (
      @id, @name, @artist, @track, @videoId, @externalLink, @source, @viewCount,
      @extractionStatus, @lastError,
      @spectralCentroidMean, @spectralFlatnessMean, @tempoBpm, @rawTempoBpm, @rmsMean, @rmsVar, @energyValence,
      @featuresJson, @vectorJson, @extractedAt, datetime('now'), @discoveredByUserId
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, artist=excluded.artist, track=excluded.track,
      video_id=excluded.video_id, external_link=excluded.external_link, source=excluded.source,
      view_count=excluded.view_count,
      extraction_status=excluded.extraction_status, last_error=excluded.last_error,
      spectral_centroid_mean=excluded.spectral_centroid_mean,
      spectral_flatness_mean=excluded.spectral_flatness_mean,
      tempo_bpm=excluded.tempo_bpm, raw_tempo_bpm=excluded.raw_tempo_bpm,
      rms_mean=excluded.rms_mean, rms_var=excluded.rms_var,
      energy_valence=excluded.energy_valence,
      features_json=excluded.features_json, vector_json=excluded.vector_json,
      extracted_at=excluded.extracted_at, updated_at=datetime('now')
  `),

  insertWorkspaceNode: db.prepare(`
    INSERT INTO workspace_nodes (user_id, id, kind, via_id, cosine_score)
    VALUES (@userId, @id, @kind, @viaId, @cosineScore)
    ON CONFLICT(user_id, id) DO UPDATE SET
      kind = excluded.kind,
      via_id = COALESCE(excluded.via_id, workspace_nodes.via_id),
      cosine_score = COALESCE(excluded.cosine_score, workspace_nodes.cosine_score),
      updated_at = datetime('now')
  `),
  setWorkspaceNodeSimilarity: db.prepare(
    `UPDATE workspace_nodes SET similarity=@similarity, updated_at=datetime('now') WHERE user_id=@userId AND id=@id`
  ),
  clearViaIdReferences: db.prepare(
    `UPDATE workspace_nodes SET via_id=NULL, similarity=NULL, updated_at=datetime('now') WHERE user_id=? AND via_id=?`
  ),
  getOrphanCandidates: db.prepare(`SELECT id FROM workspace_nodes WHERE user_id=? AND via_id=?`),
  deleteWorkspaceNode: db.prepare(`DELETE FROM workspace_nodes WHERE user_id=? AND id=?`),
  clearWorkspaceNodes: db.prepare(`DELETE FROM workspace_nodes WHERE user_id=?`),
  clearWorkspaceDiscoveries: db.prepare(`DELETE FROM workspace_discoveries WHERE user_id=?`),

  upsertWorkspaceDiscovery: db.prepare(`
    INSERT INTO workspace_discoveries (user_id, child_id, parent_id, similarity, cosine_score)
    VALUES (@userId, @childId, @parentId, @similarity, @cosineScore)
    ON CONFLICT(user_id, child_id, parent_id) DO UPDATE SET
      similarity = COALESCE(excluded.similarity, workspace_discoveries.similarity),
      cosine_score = COALESCE(excluded.cosine_score, workspace_discoveries.cosine_score)
  `),
  getAllDiscoveries: db.prepare(`SELECT child_id AS childId, parent_id AS parentId, similarity, cosine_score AS cosineScore FROM workspace_discoveries WHERE user_id=?`),
  setPrimaryDiscoverySimilarity: db.prepare(`
    UPDATE workspace_discoveries SET similarity=@similarity
    WHERE user_id=@userId AND child_id=@id AND parent_id=(SELECT via_id FROM workspace_nodes WHERE user_id=@userId AND id=@id)
  `),
  deleteDiscoveriesInvolving: db.prepare(`DELETE FROM workspace_discoveries WHERE user_id=? AND (parent_id=? OR child_id=?)`),
  getWorkspaceRows: db.prepare(`
    SELECT wn.id, wn.kind, wn.via_id AS viaId, wn.similarity, wn.cosine_score AS cosineScore, wn.added_at AS addedAt,
           t.name, t.artist, t.track, t.video_id AS videoId, t.external_link AS externalLink, t.source,
           t.view_count AS viewCount, t.extraction_status AS extractionStatus, t.last_error AS lastError,
           t.tempo_bpm AS tempoBpm, t.rms_mean AS rmsMean, t.rms_var AS rmsVar, t.energy_valence AS energyValence,
           t.features_json AS featuresJson, t.vector_json AS vectorJson
    FROM workspace_nodes wn LEFT JOIN tracks t ON t.id = wn.id
    WHERE wn.user_id = ?
    ORDER BY wn.added_at ASC
  `),

  getUserByGoogleSub: db.prepare(`SELECT * FROM users WHERE google_sub = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  getUserByDisplayName: db.prepare(`SELECT 1 FROM users WHERE display_name = ?`),
  insertUser: db.prepare(`
    INSERT INTO users (google_sub, email, given_name, family_name, display_name, avatar_url)
    VALUES (@googleSub, @email, @givenName, @familyName, @displayName, @avatarUrl)
  `),
  updateDisplayName: db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`),
  insertSession: db.prepare(`INSERT INTO sessions (token, user_id) VALUES (@token, @userId)`),
  getSessionUser: db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),

  getFavoriteTrackIds: db.prepare(`SELECT track_id AS trackId FROM favorites WHERE user_id = ?`),
  insertFavorite: db.prepare(`INSERT OR IGNORE INTO favorites (user_id, track_id) VALUES (@userId, @trackId)`),
  deleteFavorite: db.prepare(`DELETE FROM favorites WHERE user_id = ? AND track_id = ?`),

  getOkTrackVectors: db.prepare(`SELECT id, vector_json AS vectorJson, view_count AS viewCount FROM tracks WHERE extraction_status = 'ok'`),
  getAllOkTracks: db.prepare(`
    SELECT t.id, t.name, t.artist, t.track, t.video_id AS videoId, t.view_count AS viewCount,
           t.tempo_bpm AS tempoBpm, t.energy_valence AS energyValence,
           u.display_name AS discoveredByDisplayName
    FROM tracks t LEFT JOIN users u ON u.id = t.discovered_by_user_id
    WHERE t.extraction_status = 'ok'
  `),
  backfillDiscoveredBy: db.prepare(`UPDATE tracks SET discovered_by_user_id = ? WHERE discovered_by_user_id IS NULL`),
  getDistance: db.prepare(`SELECT * FROM distances WHERE track_a_id = ? AND track_b_id = ?`),
  upsertDistance: db.prepare(`
    INSERT INTO distances (track_a_id, track_b_id, cosine_score, population_size, computed_at)
    VALUES (@trackAId, @trackBId, @cosineScore, @populationSize, datetime('now'))
    ON CONFLICT(track_a_id, track_b_id) DO UPDATE SET
      cosine_score=excluded.cosine_score, population_size=excluded.population_size,
      computed_at=excluded.computed_at
  `),
  clearDistances: db.prepare(`DELETE FROM distances`),

  updateTrackBpmFields: db.prepare(`
    UPDATE tracks SET tempo_bpm=@tempoBpm, raw_tempo_bpm=@rawTempoBpm,
      vector_json=@vectorJson, energy_valence=@energyValence, updated_at=datetime('now')
    WHERE id=@id
  `),
  getOkTracksForBpmBackfill: db.prepare(`
    SELECT id, tempo_bpm, raw_tempo_bpm, rms_mean, spectral_centroid_mean, vector_json
    FROM tracks WHERE extraction_status = 'ok'
  `),
};

function getTrackRecord(id) {
  return stmts.getById.get(id);
}

// Bumped whenever a track's vector/extraction_status could have changed —
// lets distanceService memoize computeGlobalStandardizer() instead of
// re-scanning+JSON.parse-ing every 'ok' track on every distance-related request.
let standardizerVersion = 0;
function getStandardizerVersion() {
  return standardizerVersion;
}

function saveTrackRecord(record) {
  stmts.upsert.run({ discoveredByUserId: null, ...record });
  standardizerVersion += 1;
}

function backfillDiscoveredBy(userId) {
  return stmts.backfillDiscoveredBy.run(userId);
}

function getWorkspaceRows(userId) {
  return stmts.getWorkspaceRows.all(userId);
}

// Dual-writes the primary relationship into workspace_discoveries too, so a
// brand-new node's first parent is reflected there with zero extra frontend
// calls — workspace_nodes.via_id stays the legacy single-column record.
const upsertWorkspaceNode = db.transaction(({ userId, id, kind, viaId = null, cosineScore = null }) => {
  stmts.insertWorkspaceNode.run({ userId, id, kind, viaId, cosineScore });
  if (viaId) {
    stmts.upsertWorkspaceDiscovery.run({ userId, childId: id, parentId: viaId, similarity: null, cosineScore });
  }
});

function setWorkspaceNodeSimilarity(userId, id, similarity) {
  stmts.setWorkspaceNodeSimilarity.run({ userId, id, similarity });
  stmts.setPrimaryDiscoverySimilarity.run({ userId, id, similarity });
}

function upsertWorkspaceDiscovery(userId, { childId, parentId, similarity = null, cosineScore = null }) {
  stmts.upsertWorkspaceDiscovery.run({ userId, childId, parentId, similarity, cosineScore });
}

function getAllDiscoveries(userId) {
  return stmts.getAllDiscoveries.all(userId);
}

// Deletes a workspace node and orphans (via_id/similarity -> NULL) anything
// that pointed at it via the legacy column, rather than cascading — a
// discovered node's real, already-extracted data is worth keeping even if
// its provenance edge goes. Also removes every workspace_discoveries row
// involving this node (as either parent or child) — a track can have
// several parents now, so removing one node should only sever its own
// relationships, not every relationship any of its co-parents still have.
const removeWorkspaceNode = db.transaction((userId, id) => {
  const orphaned = stmts.getOrphanCandidates.all(userId, id).map((r) => r.id);
  stmts.clearViaIdReferences.run(userId, id);
  stmts.deleteDiscoveriesInvolving.run(userId, id, id);
  const result = stmts.deleteWorkspaceNode.run(userId, id);
  return { changes: result.changes, orphaned };
});

// workspace_discoveries isn't covered by workspace_nodes' FK-in-name-only
// relationship (foreign_keys is OFF), so clearing nodes alone leaves stale
// discovery rows pointing at ids that no longer exist -- must clear both.
const clearWorkspace = db.transaction((userId) => {
  const changes = stmts.clearWorkspaceNodes.run(userId).changes;
  stmts.clearWorkspaceDiscoveries.run(userId);
  return changes;
});

function getUserByGoogleSub(googleSub) {
  return stmts.getUserByGoogleSub.get(googleSub);
}

function getUserById(id) {
  return stmts.getUserById.get(id);
}

function isDisplayNameTaken(displayName) {
  return !!stmts.getUserByDisplayName.get(displayName);
}

function insertUser(record) {
  const { lastInsertRowid } = stmts.insertUser.run(record);
  return getUserById(lastInsertRowid);
}

function updateDisplayName(userId, displayName) {
  stmts.updateDisplayName.run(displayName, userId);
}

function createSession(token, userId) {
  stmts.insertSession.run({ token, userId });
}

function getSessionUser(token) {
  return stmts.getSessionUser.get(token);
}

function deleteSession(token) {
  stmts.deleteSession.run(token);
}

function getFavoriteTrackIds(userId) {
  return stmts.getFavoriteTrackIds.all(userId).map((r) => r.trackId);
}

function insertFavorite(userId, trackId) {
  stmts.insertFavorite.run({ userId, trackId });
}

function deleteFavorite(userId, trackId) {
  stmts.deleteFavorite.run(userId, trackId);
}

function getOkTrackVectors() {
  return stmts.getOkTrackVectors.all();
}

function getAllOkTracks() {
  return stmts.getAllOkTracks.all();
}

function getCachedDistance(trackAId, trackBId) {
  return stmts.getDistance.get(trackAId, trackBId);
}

// Batched replacement for calling getCachedDistance once per candidate in a
// loop — one query for every (id, otherId) pair instead of N. Returns a Map
// keyed by otherId (canonical ordering is resolved internally, callers don't
// need to think about it).
function getCachedDistancesFor(id, otherIds) {
  const result = new Map();
  if (otherIds.length === 0) return result;
  const placeholders = otherIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT track_a_id AS trackAId, track_b_id AS trackBId, cosine_score AS cosineScore
    FROM distances
    WHERE (track_a_id = ? AND track_b_id IN (${placeholders}))
       OR (track_b_id = ? AND track_a_id IN (${placeholders}))
  `).all(id, ...otherIds, id, ...otherIds);
  for (const row of rows) {
    const otherId = row.trackAId === id ? row.trackBId : row.trackAId;
    result.set(otherId, row.cosineScore);
  }
  return result;
}

function saveDistance(record) {
  stmts.upsertDistance.run(record);
}

function clearDistanceCache() {
  return stmts.clearDistances.run().changes;
}

function updateTrackBpmFields(record) {
  stmts.updateTrackBpmFields.run(record);
  standardizerVersion += 1;
}

function getOkTracksForBpmBackfill() {
  return stmts.getOkTracksForBpmBackfill.all();
}

module.exports = {
  db,
  getTrackRecord,
  saveTrackRecord,
  getWorkspaceRows,
  upsertWorkspaceNode,
  setWorkspaceNodeSimilarity,
  upsertWorkspaceDiscovery,
  getAllDiscoveries,
  removeWorkspaceNode,
  clearWorkspace,
  getOkTrackVectors,
  getAllOkTracks,
  getCachedDistance,
  getCachedDistancesFor,
  saveDistance,
  clearDistanceCache,
  updateTrackBpmFields,
  getOkTracksForBpmBackfill,
  getStandardizerVersion,
  getUserByGoogleSub,
  getUserById,
  isDisplayNameTaken,
  insertUser,
  updateDisplayName,
  createSession,
  getSessionUser,
  deleteSession,
  getFavoriteTrackIds,
  insertFavorite,
  deleteFavorite,
  backfillDiscoveredBy,
};
