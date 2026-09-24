const { COSINE_API_BASE, COSINE_API_KEY, COSINE_REQUEST_TIMEOUT_MS } = require('../config');
const { AppError } = require('../utils/errors');
const limiter = require('./rateLimiter');

async function rawRequest(pathAndQuery, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COSINE_REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${COSINE_API_BASE}${pathAndQuery}`, {
      method,
      headers: {
        Authorization: `Bearer ${COSINE_API_KEY}`,
        'User-Agent': 'NearfieldSpace/0.1 (personal project)',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError('UPSTREAM_TIMEOUT', 'cosine.club request timed out', { retryable: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    throw new AppError('BAD_REQUEST', body?.message || 'Invalid request to cosine.club');
  }
  if (res.status === 429) {
    throw new AppError('UPSTREAM_RATE_LIMIT', 'cosine.club rate limit hit', { retryable: true });
  }
  if (!res.ok) {
    throw new AppError('UPSTREAM_ERROR', `cosine.club returned ${res.status}`, { retryable: true });
  }
  return res.json();
}

// All upstream calls go through the shared limiter so a wide discovery run
// spreads across the 120/min budget rather than bursting past it.
function request(pathAndQuery, opts) {
  return limiter.schedule(() => rawRequest(pathAndQuery, opts));
}

function normalizeTrack(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    artist: t.artist,
    track: t.track,
    videoId: t.video_id ?? null,
    videoUri: t.video_uri ?? null,
    externalLink: t.external_link ?? null,
    source: t.source ?? null,
    score: typeof t.score === 'number' ? t.score : undefined,
  };
}

async function search(query) {
  const json = await request(`/search?q=${encodeURIComponent(query)}`);
  return (json?.data || []).map(normalizeTrack);
}

async function getTrack(id) {
  const json = await request(`/tracks/${encodeURIComponent(id)}`);
  return normalizeTrack(json?.data);
}

// Fetches the full similar_tracks list from upstream — its own `limit` support
// is unconfirmed, so callers slice/walk the returned array themselves.
async function getSimilar(id) {
  const json = await request(`/tracks/${encodeURIComponent(id)}/similar`);
  if (!json?.data) return null;
  return {
    sourceTrack: normalizeTrack(json.data.source_track),
    similarTracks: (json.data.similar_tracks || []).map(normalizeTrack),
  };
}

// Natively supported by cosine.club: YouTube, Discogs, Bandcamp, Nina,
// SoundCloud. Spotify is NOT supported here — that's handled client-side by
// resolving the track title via Spotify's public oEmbed endpoint first, then
// falling back to a normal text search.
async function lookupByUrl(url) {
  const json = await request(`/tracks/lookup?url=${encodeURIComponent(url)}`);
  return (json?.data || []).map(normalizeTrack);
}

module.exports = { search, getTrack, getSimilar, lookupByUrl };
