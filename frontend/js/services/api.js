import { getToken } from './auth.js';

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

// Every API route requires sign-in (see backend/server.js) -- this is the
// single place that attaches the current session's bearer token, so no
// individual call site has to think about auth.
async function authedFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${getToken()}` };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  return handle(res);
}

export async function search(query) {
  const json = await authedFetch(`/search?q=${encodeURIComponent(query)}`);
  return json.results;
}

export async function lookupByUrl(url) {
  const json = await authedFetch(`/lookup?url=${encodeURIComponent(url)}`);
  return json.results;
}

export async function getSimilar(id, limit = 10) {
  return authedFetch(`/tracks/${encodeURIComponent(id)}/similar?limit=${limit}`);
}

// Discovery path for tracks with no cosine.club id (e.g. manually-added) —
// ranks against every other track ever analyzed in our own cache, rather
// than asking cosine.club's /similar.
export async function getNearestTracks(id, limit = 20) {
  return authedFetch(`/tracks/${encodeURIComponent(id)}/nearest?limit=${limit}`);
}

export async function getFeatures(id, { refresh = false } = {}) {
  return authedFetch(`/tracks/${encodeURIComponent(id)}/features${refresh ? '?refresh=1' : ''}`);
}

// For tracks not in cosine.club's catalog — extracts directly from a
// YouTube/Bandcamp/SoundCloud URL. Can take ~10-20s (real extraction, no cache hit possible on first call).
export async function addManualTrack(url) {
  return authedFetch('/tracks/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

// For a plain-text search with zero cosine.club matches — finds a release on
// Discogs, resolves it to a YouTube video, and extracts directly. Same
// ~10-20s real-extraction cost as addManualTrack.
export async function discogsFallbackLookup(query) {
  return authedFetch('/tracks/discogs-fallback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

export async function getWorkspace() {
  return authedFetch('/workspace');
}

export async function addWorkspaceNode({ id, kind, viaId = null, cosineScore = null }) {
  return authedFetch('/workspace/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, kind, viaId, cosineScore }),
  });
}

// Records an additional (non-primary) parent relationship for a track
// that's already in the graph -- used when a second, independent discovery
// run surfaces an already-known track from a different pinned seed.
export async function addWorkspaceDiscovery({ childId, parentId, similarity = null, cosineScore = null }) {
  return authedFetch('/workspace/discoveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childId, parentId, similarity, cosineScore }),
  });
}

export async function setWorkspaceNodeSimilarity(id, similarity) {
  return authedFetch(`/workspace/nodes/${encodeURIComponent(id)}/similarity`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ similarity }),
  });
}

export async function removeWorkspaceNode(id) {
  return authedFetch(`/workspace/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function clearWorkspace() {
  return authedFetch('/workspace', { method: 'DELETE' });
}

export async function getBatchDistances(ids, threshold = 0.85) {
  return authedFetch('/distances/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, threshold }),
  });
}

export async function getLibraryGraph(threshold = 0.75) {
  return authedFetch(`/graph/library?threshold=${encodeURIComponent(threshold)}`);
}

export async function getFavorites() {
  const json = await authedFetch('/favorites');
  return json.trackIds;
}

export async function addFavorite(trackId) {
  return authedFetch(`/favorites/${encodeURIComponent(trackId)}`, { method: 'POST' });
}

export async function removeFavorite(trackId) {
  return authedFetch(`/favorites/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
}
