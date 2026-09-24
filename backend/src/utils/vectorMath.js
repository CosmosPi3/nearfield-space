// Small CommonJS port of frontend/js/models/similarity.js's math. Can't
// literally share the module (browser ES modules vs Node CommonJS) — this
// is the source of truth for anything persisted; the frontend copy is now
// scoped to exactly one legitimate remaining consumer (discoverFrom's
// per-hop seed-scoring, a live ranking decision, not a stored fact).

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values, m = mean(values)) {
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeStandardizer(vectors) {
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

// Elementwise multiply — apply after standardizing and before normalizing so
// each named feature group's share of the final cosine score is controlled
// explicitly (see config.VECTOR_DIMENSION_WEIGHTS) rather than by raw dim count.
function applyWeights(vector, weights) {
  return vector.map((v, i) => v * weights[i]);
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0)) || 1;
  return vector.map((v) => v / norm);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  // Floating-point rounding can push this a hair past +/-1 (e.g. -1.0000000000000007),
  // which then fails an inclusive `>= -1` threshold filter elsewhere — clamp to the true range.
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

module.exports = { computeStandardizer, applyWeights, normalizeVector, cosineSimilarity };
