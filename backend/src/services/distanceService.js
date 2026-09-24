const db = require('../db');
const { computeStandardizer, applyWeights, normalizeVector, cosineSimilarity } = require('../utils/vectorMath');
const { VECTOR_DIMENSION_WEIGHTS } = require('../config');
const { AppError } = require('../utils/errors');

const DEFAULT_THRESHOLD = 0.85;
// The /library route passes every successfully-analyzed track — a trusted,
// internal caller, not arbitrary user input — so this only needs to be a
// sanity ceiling, not a tight one. All-pairs work is O(n^2); 2000 tracks is
// ~2M pairs, still comfortably sub-second against SQLite at personal-tool
// scale (see computeGlobalStandardizer's own scale note below).
const MAX_BATCH_IDS = 2000;

// Recomputed fresh per request rather than persisted — at realistic personal-
// tool scale (hundreds-to-low-thousands of tracks) this is dominated by the
// SQLite read + JSON.parse, comfortably sub-30ms. See plan doc for the math
// on why staleness from this is deliberately accepted rather than tracked.
function computeGlobalStandardizer() {
  const rows = db.getOkTrackVectors();
  const vectors = rows.map((r) => JSON.parse(r.vectorJson));
  return { standardizer: computeStandardizer(vectors), populationSize: rows.length };
}

function canonicalPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

function getOkTrack(id) {
  const track = db.getTrackRecord(id);
  if (!track || track.extraction_status !== 'ok') return null;
  return track;
}

function vectorFor(rawJson, standardizer) {
  return normalizeVector(applyWeights(standardizer.standardize(JSON.parse(rawJson)), VECTOR_DIMENSION_WEIGHTS));
}

function getPairwiseDistance(rawIdA, rawIdB) {
  if (rawIdA === rawIdB) throw new AppError('BAD_REQUEST', "A track's distance to itself isn't a meaningful stored fact");

  const [trackAId, trackBId] = canonicalPair(rawIdA, rawIdB);
  const cached = db.getCachedDistance(trackAId, trackBId);
  if (cached) {
    return {
      trackAId, trackBId, cosineScore: cached.cosine_score, cached: true,
      populationSize: cached.population_size, computedAt: cached.computed_at,
    };
  }

  const trackA = getOkTrack(trackAId);
  if (!trackA) throw new AppError('NOT_FOUND', `Track ${trackAId} is not a successfully-analyzed track`);
  const trackB = getOkTrack(trackBId);
  if (!trackB) throw new AppError('NOT_FOUND', `Track ${trackBId} is not a successfully-analyzed track`);

  const { standardizer, populationSize } = computeGlobalStandardizer();
  const vecA = vectorFor(trackA.vector_json, standardizer);
  const vecB = vectorFor(trackB.vector_json, standardizer);
  const cosineScore = cosineSimilarity(vecA, vecB);

  const record = { trackAId, trackBId, cosineScore, populationSize };
  db.saveDistance(record);
  return { ...record, cached: false, computedAt: new Date().toISOString() };
}

function getBatchDistances(ids, threshold = DEFAULT_THRESHOLD) {
  if (!Array.isArray(ids) || ids.length < 2) throw new AppError('BAD_REQUEST', 'ids must be an array of at least 2 track ids');
  // Cosine similarity on standardized vectors legitimately ranges over
  // [-1,1], not [0,1] — a caller passing -1 means "no filtering at all".
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    throw new AppError('BAD_REQUEST', 'threshold must be a finite number in [-1,1]');
  }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > MAX_BATCH_IDS) {
    throw new AppError('BAD_REQUEST', `Too many ids: max ${MAX_BATCH_IDS} per batch request`);
  }

  const skippedIds = [];
  const resolvedIds = [];
  const rawVectors = new Map();
  for (const id of uniqueIds) {
    const track = getOkTrack(id);
    if (!track) {
      skippedIds.push(id);
      continue;
    }
    resolvedIds.push(id);
    rawVectors.set(id, JSON.parse(track.vector_json));
  }

  const { standardizer, populationSize } = computeGlobalStandardizer();
  const standardized = new Map();
  for (const id of resolvedIds) {
    standardized.set(id, normalizeVector(applyWeights(standardizer.standardize(rawVectors.get(id)), VECTOR_DIMENSION_WEIGHTS)));
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  const allPairs = [];

  const run = db.db.transaction(() => {
    for (let i = 0; i < resolvedIds.length; i++) {
      for (let j = i + 1; j < resolvedIds.length; j++) {
        const [trackAId, trackBId] = canonicalPair(resolvedIds[i], resolvedIds[j]);
        let cosineScore;
        const cached = db.getCachedDistance(trackAId, trackBId);
        if (cached) {
          cosineScore = cached.cosine_score;
          cacheHits += 1;
        } else {
          cosineScore = cosineSimilarity(standardized.get(trackAId), standardized.get(trackBId));
          db.saveDistance({ trackAId, trackBId, cosineScore, populationSize });
          cacheMisses += 1;
        }
        allPairs.push({ trackAId, trackBId, cosineScore });
      }
    }
  });
  run();

  return {
    pairs: allPairs.filter((p) => p.cosineScore >= threshold),
    populationSize,
    consideredPairs: allPairs.length,
    cacheHits,
    cacheMisses,
    skippedIds,
  };
}

const DEFAULT_NEAREST_LIMIT = 20;
const MAX_NEAREST_LIMIT = 200;

// Ranks `id` against every other successfully-analyzed track (not just a
// given candidate list) — the "discover from a track with no cosine.club id"
// path, where there's no external candidate generator to ask. Single O(N)
// pass; fine at realistic personal-tool scale (see computeGlobalStandardizer).
function getNearestTracks(id, limit = DEFAULT_NEAREST_LIMIT) {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
    throw new AppError('BAD_REQUEST', 'limit must be a positive number');
  }
  const cappedLimit = Math.min(limit, MAX_NEAREST_LIMIT);

  const anchor = getOkTrack(id);
  if (!anchor) throw new AppError('NOT_FOUND', `Track ${id} is not a successfully-analyzed track`);

  const { standardizer, populationSize } = computeGlobalStandardizer();
  const anchorVec = vectorFor(anchor.vector_json, standardizer);

  const scored = [];
  const run = db.db.transaction(() => {
    for (const row of db.getOkTrackVectors()) {
      if (row.id === id) continue;
      const [trackAId, trackBId] = canonicalPair(id, row.id);
      let cosineScore;
      const cached = db.getCachedDistance(trackAId, trackBId);
      if (cached) {
        cosineScore = cached.cosine_score;
      } else {
        const vec = vectorFor(row.vectorJson, standardizer);
        cosineScore = cosineSimilarity(anchorVec, vec);
        db.saveDistance({ trackAId, trackBId, cosineScore, populationSize });
      }
      scored.push({ id: row.id, cosineScore, viewCount: row.viewCount ?? null });
    }
  });
  run();

  scored.sort((a, b) => b.cosineScore - a.cosineScore);
  return { neighbors: scored.slice(0, cappedLimit), populationSize };
}

function clearDistanceCache() {
  return { cleared: db.clearDistanceCache() };
}

module.exports = { getPairwiseDistance, getBatchDistances, getNearestTracks, clearDistanceCache };
