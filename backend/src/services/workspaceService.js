const db = require('../db');
const { AppError } = require('../utils/errors');

const VALID_KINDS = new Set(['seed', 'discovered']);

function assertDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 128) {
    throw new AppError('BAD_REQUEST', 'X-Device-Id header is required');
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
function getWorkspace(deviceId) {
  assertDeviceId(deviceId);
  const rows = db.getWorkspaceRows(deviceId);
  const nodes = rows.map(rowToNode);
  const links = db.getAllDiscoveries(deviceId)
    .map((d) => ({ source: d.parentId, target: d.childId, type: 'discovered-via', similarity: d.similarity, cosineScore: d.cosineScore }));
  return { nodes, links };
}

function addNode(deviceId, { id, kind, viaId = null, cosineScore = null }) {
  assertDeviceId(deviceId);
  if (!id) throw new AppError('BAD_REQUEST', 'id is required');
  if (!VALID_KINDS.has(kind)) throw new AppError('BAD_REQUEST', `kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  db.upsertWorkspaceNode({ deviceId, id, kind, viaId, cosineScore });
}

// Records an additional (non-primary) parent relationship for a track that's
// already in the graph -- the multi-parent case discoverFrom creates when a
// second, independent discovery run surfaces an already-known track.
function addDiscovery(deviceId, { childId, parentId, similarity = null, cosineScore = null }) {
  assertDeviceId(deviceId);
  if (!childId || !parentId) throw new AppError('BAD_REQUEST', 'childId and parentId are required');
  db.upsertWorkspaceDiscovery(deviceId, { childId, parentId, similarity, cosineScore });
}

function setSimilarity(deviceId, id, similarity) {
  assertDeviceId(deviceId);
  if (typeof similarity !== 'number' || !Number.isFinite(similarity)) {
    throw new AppError('BAD_REQUEST', 'similarity must be a finite number');
  }
  db.setWorkspaceNodeSimilarity(deviceId, id, similarity);
}

function removeNode(deviceId, id) {
  assertDeviceId(deviceId);
  const { changes, orphaned } = db.removeWorkspaceNode(deviceId, id);
  if (changes === 0) throw new AppError('NOT_FOUND', `Workspace node ${id} not found`);
  return { removedId: id, orphanedIds: orphaned };
}

// Clears the workspace graph only (which tracks are in the current
// exploration, their roles/edges) -- the distances cache and the tracks
// feature cache are untouched; every score ever computed stays reusable.
function clearWorkspace(deviceId) {
  assertDeviceId(deviceId);
  return { cleared: db.clearWorkspace(deviceId) };
}

module.exports = { getWorkspace, addNode, addDiscovery, setSimilarity, removeNode, clearWorkspace };
