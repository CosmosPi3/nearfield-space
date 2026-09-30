const { DISCOGS_API_BASE, DISCOGS_API_TOKEN, DISCOGS_REQUEST_TIMEOUT_MS } = require('../config');
const { AppError } = require('../utils/errors');
const limiter = require('./discogsRateLimiter');

async function rawRequest(pathAndQuery) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOGS_REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${DISCOGS_API_BASE}${pathAndQuery}`, {
      headers: {
        Authorization: `Discogs token=${DISCOGS_API_TOKEN}`,
        'User-Agent': 'NearfieldSpace/0.1 (personal project)',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError('UPSTREAM_TIMEOUT', 'Discogs request timed out', { retryable: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    throw new AppError('UPSTREAM_RATE_LIMIT', 'Discogs rate limit hit', { retryable: true });
  }
  if (!res.ok) {
    throw new AppError('UPSTREAM_ERROR', `Discogs returned ${res.status}`, { retryable: true });
  }
  return res.json();
}

function request(pathAndQuery) {
  return limiter.schedule(() => rawRequest(pathAndQuery));
}

// Discogs release titles are "Artist - Release Title", not an individual
// track title — good enough for singles/12"s (this catalog's common case),
// but can pick the wrong specific song on a multi-track release.
function splitArtistTrack(title) {
  const idx = title.indexOf(' - ');
  if (idx === -1) return { artist: null, track: title };
  return { artist: title.slice(0, idx), track: title.slice(idx + 3) };
}

const CANDIDATE_PAGE_SIZE = 10;

function normalizeWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Discogs' own relevance ranking can put a release ahead of an exact-title
// match purely because a repeated word (e.g. a self-titled release by an
// artist whose name is also the query) inflates its raw text-match score —
// verified live: "Rihanna Diamonds" ranked "Rihanna - Rihanna" (a self-titled
// compilation) above the actual "Rihanna - Diamonds" single. Re-scoring the
// top page ourselves by distinct query-word coverage of the *whole* title,
// tie-broken toward the shortest (most exact) title, consistently surfaces
// the real match instead.
function pickBestCandidate(query, results) {
  const queryWords = new Set(normalizeWords(query));
  let best = null;
  results.forEach((result, idx) => {
    if (!result?.title) return;
    const titleWords = normalizeWords(result.title);
    const matched = new Set(titleWords.filter((w) => queryWords.has(w))).size;
    const candidate = { result, matched, totalWords: titleWords.length, idx };
    if (!best
      || candidate.matched > best.matched
      || (candidate.matched === best.matched && candidate.totalWords < best.totalWords)
    ) {
      best = candidate;
    }
  });
  return best?.result ?? null;
}

async function searchTopRelease(query) {
  const json = await request(`/database/search?type=release&per_page=${CANDIDATE_PAGE_SIZE}&q=${encodeURIComponent(query)}`);
  const top = pickBestCandidate(query, json?.results || []);
  if (!top?.title) return null;
  return splitArtistTrack(top.title);
}

module.exports = { searchTopRelease };
