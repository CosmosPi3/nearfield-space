const BASE = (() => {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return '/api';
  return 'https://api.nearfield.space/api';
})();

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || `Request failed (${res.status})`);
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function search(query) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`);
  const json = await handle(res);
  return json.results;
}

export async function lookupByUrl(url) {
  const res = await fetch(`${BASE}/lookup?url=${encodeURIComponent(url)}`);
  const json = await handle(res);
  return json.results;
}

export async function getSimilar(id, limit = 10) {
  const res = await fetch(`${BASE}/tracks/${encodeURIComponent(id)}/similar?limit=${limit}`);
  return handle(res);
}

// Discovery path for tracks with no cosine.club id (e.g. manually-added) —
// ranks against every other track ever analyzed in our own cache, rather
// than asking cosine.club's /similar.
export async function getNearestTracks(id, limit = 20) {
  const res = await fetch(`${BASE}/tracks/${encodeURIComponent(id)}/nearest?limit=${limit}`);
  return handle(res);
}

export async function getFeatures(id, { refresh = false } = {}) {
  const res = await fetch(`${BASE}/tracks/${encodeURIComponent(id)}/features${refresh ? '?refresh=1' : ''}`);
  return handle(res);
}

// For tracks not in cosine.club's catalog — extracts directly from a
// YouTube/Bandcamp/SoundCloud URL. Can take ~10-20s (real extraction, no cache hit possible on first call).
export async function addManualTrack(url) {
  const res = await fetch(`${BASE}/tracks/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handle(res);
}

export async function getWorkspace() {
  const res = await fetch(`${BASE}/workspace`);
  return handle(res);
}

export async function addWorkspaceNode({ id, kind, viaId = null, cosineScore = null }) {
  const res = await fetch(`${BASE}/workspace/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, kind, viaId, cosineScore }),
  });
  return handle(res);
}

// Records an additional (non-primary) parent relationship for a track
// that's already in the graph — used when a second, independent discovery
// run surfaces an already-known track from a different pinned seed.
export async function addWorkspaceDiscovery({ childId, parentId, similarity = null, cosineScore = null }) {
  const res = await fetch(`${BASE}/workspace/discoveries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childId, parentId, similarity, cosineScore }),
  });
  return handle(res);
}

export async function setWorkspaceNodeSimilarity(id, similarity) {
  const res = await fetch(`${BASE}/workspace/nodes/${encodeURIComponent(id)}/similarity`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ similarity }),
  });
  return handle(res);
}

export async function removeWorkspaceNode(id) {
  const res = await fetch(`${BASE}/workspace/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return handle(res);
}

export async function clearWorkspace() {
  const res = await fetch(`${BASE}/workspace`, { method: 'DELETE' });
  return handle(res);
}

export async function getBatchDistances(ids, threshold = 0.85) {
  const res = await fetch(`${BASE}/distances/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, threshold }),
  });
  return handle(res);
}

export async function getLibraryGraph(threshold = 0.75) {
  const res = await fetch(`${BASE}/graph/library?threshold=${encodeURIComponent(threshold)}`);
  return handle(res);
}
