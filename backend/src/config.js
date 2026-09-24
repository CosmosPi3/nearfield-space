require('dotenv').config();

const COSINE_API_KEY = process.env.COSINE_API_KEY;
if (!COSINE_API_KEY) {
  throw new Error('COSINE_API_KEY is not set. Add it to backend/.env');
}

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ||
    'https://nearfield.space,https://www.nearfield.space,http://localhost:3000,http://127.0.0.1:3000'
  ).split(','),
  COSINE_API_BASE: 'https://cosine.club/api/v1',
  COSINE_API_KEY,
  COSINE_RATE_LIMIT_PER_MIN: 120,

  SAMPLE_RATE: 22050,
  FRAME_SIZE: 2048,
  HOP_SIZE: 1024,
  SEGMENT_SECONDS: 45,
  SEGMENT_COUNT: 2,
  EXTRACTION_TIMEOUT_MS: 60000,
  COSINE_REQUEST_TIMEOUT_MS: 15000,

  // Rekordbox-style BPM range folding target — see utils/bpmRange.js.
  BPM_RANGE_MIN: 90,
  BPM_RANGE_MAX: 180,

  TEMP_DIR: require('path').join(__dirname, '..', 'data', 'tmp'),
  DB_PATH: require('path').join(__dirname, '..', 'data', 'cache.sqlite3'),

  // Fixed order of the 39-dim similarity vector. Every producer/consumer of
  // `vector_json` must agree on this order. energy_valence stays excluded
  // (it's a heuristic blend of tempo/rms/centroid already in this vector —
  // including it too would just double-count those dims).
  VECTOR_DIMENSIONS: [
    'spectralCentroid.mean', 'spectralCentroid.var',
    'spectralFlatness.mean', 'spectralFlatness.var',
    'spectralRolloff.mean', 'spectralRolloff.var',
    'spectralSpread.mean', 'spectralSpread.var',
    'zcr.mean', 'zcr.var',
    ...Array.from({ length: 13 }, (_, i) => `mfcc.mean.${i}`),
    ...Array.from({ length: 13 }, (_, i) => `mfcc.var.${i}`),
    'tempoBpm',
    'rms.mean', 'rms.var',
  ],
};

// Per-dimension weights, parallel to VECTOR_DIMENSIONS, so each conceptual
// feature group's share of the cosine score is controlled explicitly rather
// than by how many raw dims it happens to have — otherwise the 26-dim MFCC
// block would swamp a 1-dim tempo signal purely by count. Every dim is
// unit-variance after z-scoring, so giving a group of `n` dims weight
// sqrt(G²/n) each makes that group's expected contribution to the vector's
// squared norm exactly G² (tune these once the effect is visible in practice —
// they must stay in sync with the mirrored copy in frontend/js/models/similarity.js).
const FEATURE_GROUP_WEIGHTS_SQUARED = {
  spectralShape: 0.30, // centroid/flatness/rolloff/spread/zcr, mean+var — 10 dims
  mfcc: 0.40,           // 13 MFCC coefficients, mean+var — 26 dims
  rhythm: 0.15,         // tempoBpm — 1 dim
  dynamics: 0.15,       // rms mean+var — 2 dims
};

function groupWeight(groupSquared, dimCount) {
  return Math.sqrt(groupSquared / dimCount);
}

const spectralShapeWeight = groupWeight(FEATURE_GROUP_WEIGHTS_SQUARED.spectralShape, 10);
const mfccWeight = groupWeight(FEATURE_GROUP_WEIGHTS_SQUARED.mfcc, 26);
const rhythmWeight = groupWeight(FEATURE_GROUP_WEIGHTS_SQUARED.rhythm, 1);
const dynamicsWeight = groupWeight(FEATURE_GROUP_WEIGHTS_SQUARED.dynamics, 2);

module.exports.VECTOR_DIMENSION_WEIGHTS = [
  ...Array(10).fill(spectralShapeWeight),
  ...Array(26).fill(mfccWeight),
  rhythmWeight,
  ...Array(2).fill(dynamicsWeight),
];
