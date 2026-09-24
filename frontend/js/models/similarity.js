// Pure math — no DOM/API knowledge.

export function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values, m = mean(values)) {
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Raw dims have wildly different units (Hz-scale centroid/rolloff vs 0-1
// flatness/zcr vs +-50 MFCC) — naive cosine similarity would let Hz-scale
// features dominate. z-score standardize each dim across the given vectors
// before any similarity computation (centroid, candidate scoring, pairwise
// similarity edges alike).
export function computeStandardizer(vectors) {
  if (!vectors.length) return { standardize: (v) => v };
  const dims = vectors[0].length;
  const means = [];
  const stds = [];
  for (let d = 0; d < dims; d++) {
    const col = vectors.map((v) => v[d]);
    const m = mean(col);
    means.push(m);
    stds.push(stdDev(col, m) || 1); // avoid divide-by-zero when a dim is constant
  }
  return {
    standardize(vector) {
      return vector.map((v, d) => (v - means[d]) / stds[d]);
    },
  };
}

// Mirrors backend/src/config.js's VECTOR_DIMENSION_WEIGHTS — source of truth
// lives there. Parallel to the 39-dim vector order (VECTOR_DIMENSIONS in that
// file): 10 spectral-shape dims, 26 MFCC dims, 1 tempo dim, 2 rms dims.
// Weights give each named group an explicit share of the cosine score
// regardless of its raw dim count (w = sqrt(groupWeightSquared / dimCount)).
const SPECTRAL_SHAPE_WEIGHT = Math.sqrt(0.30 / 10);
const MFCC_WEIGHT = Math.sqrt(0.40 / 26);
const RHYTHM_WEIGHT = Math.sqrt(0.15 / 1);
const DYNAMICS_WEIGHT = Math.sqrt(0.15 / 2);

export const VECTOR_DIMENSION_WEIGHTS = [
  ...Array(10).fill(SPECTRAL_SHAPE_WEIGHT),
  ...Array(26).fill(MFCC_WEIGHT),
  RHYTHM_WEIGHT,
  ...Array(2).fill(DYNAMICS_WEIGHT),
];

// Elementwise multiply — apply after standardizing and before normalizing.
export function applyWeights(vector, weights) {
  return vector.map((v, i) => v * weights[i]);
}

export function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0)) || 1;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  // Floating-point rounding can push this a hair past +/-1 — clamp to the true range.
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}
