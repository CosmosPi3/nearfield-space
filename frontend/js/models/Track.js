// Pure data shape for a graph node — no DOM/API knowledge.
export function createTrackNode(track, { kind = 'discovered', viaId = null } = {}) {
  return {
    id: track.id,
    label: `${track.artist || 'Unknown'} - ${track.track || track.name || 'Untitled'}`,
    artist: track.artist ?? null,
    title: track.track || track.name || null,
    kind, // 'seed' | 'discovered'
    status: 'pending', // 'pending' | 'ready' | 'unavailable' | 'error'
    viaId, // id of the frontier node that surfaced this candidate, if any
    videoId: track.videoId ?? null,
    externalLink: track.externalLink ?? null,
    source: track.source ?? null,
    cosineScore: typeof track.score === 'number' ? track.score : null,
    viewCount: null,
    vector: null,
    features: null,
    tempoBpm: null,
    rms: null,
    energyValence: null,
    error: null,
  };
}

// Reconstructs a full node from a fully-hydrated /api/workspace row (already
// joined against tracks server-side) — distinct from createTrackNode, which
// is for brand-new candidates freshly surfaced from cosine.club.
export function hydrateTrackNode(row) {
  return {
    id: row.id,
    label: `${row.artist || 'Unknown'} - ${row.track || row.name || 'Untitled'}`,
    artist: row.artist ?? null,
    title: row.track || row.name || null,
    kind: row.kind,
    status: row.status,
    viaId: row.viaId ?? null,
    videoId: row.videoId ?? null,
    externalLink: row.externalLink ?? null,
    source: row.source ?? null,
    cosineScore: row.cosineScore ?? null,
    viewCount: row.viewCount ?? null,
    vector: row.vector ?? null,
    features: row.features ?? null,
    tempoBpm: row.tempoBpm ?? null,
    rms: row.rms ?? null,
    energyValence: row.energyValence ?? null,
    error: row.error ?? null,
  };
}
