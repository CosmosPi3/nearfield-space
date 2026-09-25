const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// The schema's REFERENCES clauses are documentation only, not enforced —
// workspace_nodes must be insertable before a matching tracks row necessarily
// exists (a node is persisted the instant it's added client-side, well
// before extraction/caching completes). foreign_keys defaults to ON in this
// SQLite build, so it must be explicitly turned off.
db.pragma('foreign_keys = OFF');

// One-time migration: workspace_nodes/workspace_discoveries predate device
// scoping, and SQLite can't ALTER a PRIMARY KEY, so an already-existing DB
// file's old-shape tables must be dropped before schema.sql (below) recreates
// them with device_id in the PK -- schema.sql's own backfill INSERT assumes
// that column already exists, so this must run first. Existing workspace
// data is intentionally discarded here -- there is no per-device identity to
// attribute it to. Idempotent: a fresh or already-migrated DB has no
// old-shape table to drop (table_info on a nonexistent table just returns []).
const workspaceCols = db.prepare(`PRAGMA table_info(workspace_nodes)`).all();
if (workspaceCols.length && !workspaceCols.some((c) => c.name === 'device_id')) {
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

const stmts = {
  getById: db.prepare('SELECT * FROM tracks WHERE id = ?'),
  upsert: db.prepare(`
    INSERT INTO tracks (
      id, name, artist, track, video_id, external_link, source, view_count,
      extraction_status, last_error,
      spectral_centroid_mean, spectral_flatness_mean, tempo_bpm, raw_tempo_bpm, rms_mean, rms_var, energy_valence,
      features_json, vector_json, extracted_at, updated_at
    ) VALUES (
      @id, @name, @artist, @track, @videoId, @externalLink, @source, @viewCount,
      @extractionStatus, @lastError,
      @spectralCentroidMean, @spectralFlatnessMean, @tempoBpm, @rawTempoBpm, @rmsMean, @rmsVar, @energyValence,
      @featuresJson, @vectorJson, @extractedAt, datetime('now')
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
    INSERT INTO workspace_nodes (device_id, id, kind, via_id, cosine_score)
    VALUES (@deviceId, @id, @kind, @viaId, @cosineScore)
    ON CONFLICT(device_id, id) DO UPDATE SET
      kind = excluded.kind,
      via_id = COALESCE(excluded.via_id, workspace_nodes.via_id),
      cosine_score = COALESCE(excluded.cosine_score, workspace_nodes.cosine_score),
      updated_at = datetime('now')
  `),
  setWorkspaceNodeSimilarity: db.prepare(
    `UPDATE workspace_nodes SET similarity=@similarity, updated_at=datetime('now') WHERE device_id=@deviceId AND id=@id`
  ),
  clearViaIdReferences: db.prepare(
    `UPDATE workspace_nodes SET via_id=NULL, similarity=NULL, updated_at=datetime('now') WHERE device_id=? AND via_id=?`
  ),
  getOrphanCandidates: db.prepare(`SELECT id FROM workspace_nodes WHERE device_id=? AND via_id=?`),
  deleteWorkspaceNode: db.prepare(`DELETE FROM workspace_nodes WHERE device_id=? AND id=?`),
  clearWorkspaceNodes: db.prepare(`DELETE FROM workspace_nodes WHERE device_id=?`),
  clearWorkspaceDiscoveries: db.prepare(`DELETE FROM workspace_discoveries WHERE device_id=?`),

  upsertWorkspaceDiscovery: db.prepare(`
    INSERT INTO workspace_discoveries (device_id, child_id, parent_id, similarity, cosine_score)
    VALUES (@deviceId, @childId, @parentId, @similarity, @cosineScore)
    ON CONFLICT(device_id, child_id, parent_id) DO UPDATE SET
      similarity = COALESCE(excluded.similarity, workspace_discoveries.similarity),
      cosine_score = COALESCE(excluded.cosine_score, workspace_discoveries.cosine_score)
  `),
  getAllDiscoveries: db.prepare(`SELECT child_id AS childId, parent_id AS parentId, similarity, cosine_score AS cosineScore FROM workspace_discoveries WHERE device_id=?`),
  setPrimaryDiscoverySimilarity: db.prepare(`
    UPDATE workspace_discoveries SET similarity=@similarity
    WHERE device_id=@deviceId AND child_id=@id AND parent_id=(SELECT via_id FROM workspace_nodes WHERE device_id=@deviceId AND id=@id)
  `),
  deleteDiscoveriesInvolving: db.prepare(`DELETE FROM workspace_discoveries WHERE device_id=? AND (parent_id=? OR child_id=?)`),
  getWorkspaceRows: db.prepare(`
    SELECT wn.id, wn.kind, wn.via_id AS viaId, wn.similarity, wn.cosine_score AS cosineScore, wn.added_at AS addedAt,
           t.name, t.artist, t.track, t.video_id AS videoId, t.external_link AS externalLink, t.source,
           t.view_count AS viewCount, t.extraction_status AS extractionStatus, t.last_error AS lastError,
           t.tempo_bpm AS tempoBpm, t.rms_mean AS rmsMean, t.rms_var AS rmsVar, t.energy_valence AS energyValence,
           t.features_json AS featuresJson, t.vector_json AS vectorJson
    FROM workspace_nodes wn LEFT JOIN tracks t ON t.id = wn.id
    WHERE wn.device_id = ?
    ORDER BY wn.added_at ASC
  `),

  getOkTrackVectors: db.prepare(`SELECT id, vector_json AS vectorJson, view_count AS viewCount FROM tracks WHERE extraction_status = 'ok'`),
  getAllOkTracks: db.prepare(`
    SELECT id, name, artist, track, video_id AS videoId, view_count AS viewCount,
           tempo_bpm AS tempoBpm, energy_valence AS energyValence
    FROM tracks WHERE extraction_status = 'ok'
  `),
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

function saveTrackRecord(record) {
  stmts.upsert.run(record);
}

function getWorkspaceRows(deviceId) {
  return stmts.getWorkspaceRows.all(deviceId);
}

// Dual-writes the primary relationship into workspace_discoveries too, so a
// brand-new node's first parent is reflected there with zero extra frontend
// calls — workspace_nodes.via_id stays the legacy single-column record.
const upsertWorkspaceNode = db.transaction(({ deviceId, id, kind, viaId = null, cosineScore = null }) => {
  stmts.insertWorkspaceNode.run({ deviceId, id, kind, viaId, cosineScore });
  if (viaId) {
    stmts.upsertWorkspaceDiscovery.run({ deviceId, childId: id, parentId: viaId, similarity: null, cosineScore });
  }
});

function setWorkspaceNodeSimilarity(deviceId, id, similarity) {
  stmts.setWorkspaceNodeSimilarity.run({ deviceId, id, similarity });
  stmts.setPrimaryDiscoverySimilarity.run({ deviceId, id, similarity });
}

function upsertWorkspaceDiscovery(deviceId, { childId, parentId, similarity = null, cosineScore = null }) {
  stmts.upsertWorkspaceDiscovery.run({ deviceId, childId, parentId, similarity, cosineScore });
}

function getAllDiscoveries(deviceId) {
  return stmts.getAllDiscoveries.all(deviceId);
}

// Deletes a workspace node and orphans (via_id/similarity -> NULL) anything
// that pointed at it via the legacy column, rather than cascading — a
// discovered node's real, already-extracted data is worth keeping even if
// its provenance edge goes. Also removes every workspace_discoveries row
// involving this node (as either parent or child) — a track can have
// several parents now, so removing one node should only sever its own
// relationships, not every relationship any of its co-parents still have.
const removeWorkspaceNode = db.transaction((deviceId, id) => {
  const orphaned = stmts.getOrphanCandidates.all(deviceId, id).map((r) => r.id);
  stmts.clearViaIdReferences.run(deviceId, id);
  stmts.deleteDiscoveriesInvolving.run(deviceId, id, id);
  const result = stmts.deleteWorkspaceNode.run(deviceId, id);
  return { changes: result.changes, orphaned };
});

// workspace_discoveries isn't covered by workspace_nodes' FK-in-name-only
// relationship (foreign_keys is OFF), so clearing nodes alone leaves stale
// discovery rows pointing at ids that no longer exist -- must clear both.
const clearWorkspace = db.transaction((deviceId) => {
  const changes = stmts.clearWorkspaceNodes.run(deviceId).changes;
  stmts.clearWorkspaceDiscoveries.run(deviceId);
  return changes;
});

function getOkTrackVectors() {
  return stmts.getOkTrackVectors.all();
}

function getAllOkTracks() {
  return stmts.getAllOkTracks.all();
}

function getCachedDistance(trackAId, trackBId) {
  return stmts.getDistance.get(trackAId, trackBId);
}

function saveDistance(record) {
  stmts.upsertDistance.run(record);
}

function clearDistanceCache() {
  return stmts.clearDistances.run().changes;
}

function updateTrackBpmFields(record) {
  stmts.updateTrackBpmFields.run(record);
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
  saveDistance,
  clearDistanceCache,
  updateTrackBpmFields,
  getOkTracksForBpmBackfill,
};
