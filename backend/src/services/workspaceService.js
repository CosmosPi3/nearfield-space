const db = require('../db');
const { AppError } = require('../utils/errors');

const VALID_KINDS = new Set(['seed', 'discovered']);

function assertUserId(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError('BAD_REQUEST', 'A valid authenticated user is required');
  }
}

function deriveStatus(row) {
  if (!row.extractionStatus) return 'pending';
  if (row.extractionStatus === 'ok') return 'ready';
  // featuresService.runExtraction writes this exact literal when a track has
  // no video_id — a fragile string-literal coupling, but not worth a schema
  // migration to fix for a cosmetic status distinction.
  return row.lastError === 'No video_id available' ? 'unavailable' : 'error';
}

function rowToNode(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: deriveStatus(row),
    viaId: row.viaId ?? null,
    similarity: row.similarity ?? null,
    cosineScore: row.cosineScore ?? null,
    name: row.name,
    artist: row.artist,
    track: row.track,
    videoId: row.videoId ?? null,
    externalLink: row.externalLink ?? null,
    source: row.source ?? null,
    viewCount: row.viewCount ?? null,
    vector: row.vectorJson ? JSON.parse(row.vectorJson) : null,
    features: row.featuresJson ? JSON.parse(row.featuresJson) : null,
    tempoBpm: row.tempoBpm ?? null,
    rms: row.rmsMean != null ? { mean: row.rmsMean, var: row.rmsVar } : null,
    energyValence: row.energyValence ?? null,
    error: row.lastError ?? null,
    addedAt: row.addedAt,
  };
}

// One link per discovery relationship (0-N per child now, not one-per-node)
// — workspace_discoveries is the full picture; via_id only ever recorded the
// first parent.
function getWorkspace(userId) {
  assertUserId(userId);
  const rows = db.getWorkspaceRows(userId);
  const nodes = rows.map(rowToNode);
  const links = db.getAllDiscoveries(userId)
    .map((d) => ({ source: d.parentId, target: d.childId, type: 'discovered-via', similarity: d.similarity, cosineScore: d.cosineScore }));
  return { nodes, links };
}

function addNode(userId, { id, kind, viaId = null, cosineScore = null }) {
  assertUserId(userId);
  if (!id) throw new AppError('BAD_REQUEST', 'id is required');
  if (!VALID_KINDS.has(kind)) throw new AppError('BAD_REQUEST', `kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  db.upsertWorkspaceNode({ userId, id, kind, viaId, cosineScore });
}

// Records an additional (non-primary) parent relationship for a track that's
// already in the graph -- the multi-parent case discoverFrom creates when a
// second, independent discovery run surfaces an already-known track.
function addDiscovery(userId, { childId, parentId, similarity = null, cosineScore = null }) {
  assertUserId(userId);
  if (!childId || !parentId) throw new AppError('BAD_REQUEST', 'childId and parentId are required');
  db.upsertWorkspaceDiscovery(userId, { childId, parentId, similarity, cosineScore });
}

function setSimilarity(userId, id, similarity) {
  assertUserId(userId);
  if (typeof similarity !== 'number' || !Number.isFinite(similarity)) {
    throw new AppError('BAD_REQUEST', 'similarity must be a finite number');
  }
  db.setWorkspaceNodeSimilarity(userId, id, similarity);
}

function removeNode(userId, id) {
  assertUserId(userId);
  const { changes, orphaned } = db.removeWorkspaceNode(userId, id);
  if (changes === 0) throw new AppError('NOT_FOUND', `Workspace node ${id} not found`);
  return { removedId: id, orphanedIds: orphaned };
}

// Clears the workspace graph only (which tracks are in the current
// exploration, their roles/edges) -- the distances cache and the tracks
// feature cache are untouched; every score ever computed stays reusable.
function clearWorkspace(userId) {
  assertUserId(userId);
  return { cleared: db.clearWorkspace(userId) };
}

module.exports = { getWorkspace, addNode, addDiscovery, setSimilarity, removeNode, clearWorkspace };
