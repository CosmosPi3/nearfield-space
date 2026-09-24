const Meyda = require('meyda');
const { FRAME_SIZE, HOP_SIZE, SAMPLE_RATE, VECTOR_DIMENSIONS } = require('../config');
const { normalizeBpmToRange } = require('../utils/bpmRange');

// Deliberately no chroma/key/tonal features — this vector must be pure
// timbre/texture, with no melodic or harmonic content mixed in.
const MEYDA_FEATURES = ['spectralCentroid', 'spectralFlatness', 'spectralRolloff', 'spectralSpread', 'zcr', 'mfcc', 'rms'];

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function meanVar(arr) {
  const m = mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return { mean: m, var: v };
}

function extractFrameFeatures(samples) {
  Meyda.sampleRate = SAMPLE_RATE;
  Meyda.bufferSize = FRAME_SIZE;

  const frames = [];
  for (let i = 0; i + FRAME_SIZE <= samples.length; i += HOP_SIZE) {
    const frame = samples.subarray(i, i + FRAME_SIZE);
    const feats = Meyda.extract(MEYDA_FEATURES, frame);
    if (feats && Number.isFinite(feats.spectralCentroid)) frames.push(feats);
  }
  return frames;
}

function aggregate(frames) {
  const centroid = meanVar(frames.map((f) => f.spectralCentroid));
  const flatness = meanVar(frames.map((f) => f.spectralFlatness));
  const rolloff = meanVar(frames.map((f) => f.spectralRolloff));
  const spread = meanVar(frames.map((f) => f.spectralSpread));
  const zcr = meanVar(frames.map((f) => f.zcr));
  const rms = meanVar(frames.map((f) => f.rms));
  const mfccPerCoef = Array.from({ length: 13 }, (_, i) => meanVar(frames.map((f) => f.mfcc[i])));

  return {
    features: {
      centroid, flatness, rolloff, spread, zcr,
      mfcc: { mean: mfccPerCoef.map((x) => x.mean), var: mfccPerCoef.map((x) => x.var) },
    },
    rms,
    rmsEnvelope: frames.map((f) => f.rms),
  };
}

// Coarse tempo estimate via autocorrelation of the half-wave-rectified RMS
// envelope diff — no meter/downbeat/octave-error correction. Only feeds one
// slider, so this level of rigor is intentional, not a shortcut.
function estimateTempo(rmsEnvelope) {
  const diff = rmsEnvelope.map((v, i) => (i === 0 ? 0 : Math.max(0, v - rmsEnvelope[i - 1])));
  const framesPerSec = SAMPLE_RATE / HOP_SIZE;
  const minLag = Math.max(1, Math.round((framesPerSec * 60) / 200)); // 200 BPM upper bound
  const maxLag = Math.min(diff.length - 1, Math.round((framesPerSec * 60) / 50)); // 50 BPM lower bound

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < diff.length; i++) sum += diff[i] * diff[i - lag];
    if (sum > bestScore) {
      bestScore = sum;
      bestLag = lag;
    }
  }
  return (60 * framesPerSec) / bestLag;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// HEURISTIC ONLY — a rough vibe proxy, not a trained classifier's output.
function computeEnergyValence(tempoBpm, rmsMean, centroidMean) {
  const tempoNorm = clamp((tempoBpm - 60) / 120, 0, 1);
  const rmsNorm = clamp(rmsMean / 0.5, 0, 1);
  const centroidNorm = clamp((centroidMean - 200) / 7800, 0, 1);
  return (tempoNorm + rmsNorm + centroidNorm) / 3;
}

// Flattens the structured feature object into the fixed-order 39-dim vector
// declared in config.VECTOR_DIMENSIONS — every consumer relies on this order.
function buildVector(features, tempoBpm, rms) {
  const flat = {
    'spectralCentroid.mean': features.centroid.mean, 'spectralCentroid.var': features.centroid.var,
    'spectralFlatness.mean': features.flatness.mean, 'spectralFlatness.var': features.flatness.var,
    'spectralRolloff.mean': features.rolloff.mean, 'spectralRolloff.var': features.rolloff.var,
    'spectralSpread.mean': features.spread.mean, 'spectralSpread.var': features.spread.var,
    'zcr.mean': features.zcr.mean, 'zcr.var': features.zcr.var,
    tempoBpm,
    'rms.mean': rms.mean, 'rms.var': rms.var,
  };
  features.mfcc.mean.forEach((v, i) => { flat[`mfcc.mean.${i}`] = v; });
  features.mfcc.var.forEach((v, i) => { flat[`mfcc.var.${i}`] = v; });
  return VECTOR_DIMENSIONS.map((dim) => flat[dim]);
}

// `segments` is an array of Float32Arrays (one per downloaded audio window).
// Frames are extracted per segment then concatenated, rather than splicing
// raw audio across the segments' time gap — that would create a fake
// discontinuity right at the seam.
function extractTextureFeatures(segments) {
  const frames = segments.flatMap(extractFrameFeatures);
  if (frames.length < 4) {
    throw new Error(`Only ${frames.length} usable frames extracted — audio segment too short or silent`);
  }
  const { features, rms, rmsEnvelope } = aggregate(frames);
  const tempoBpmRaw = estimateTempo(rmsEnvelope);
  const tempoBpm = normalizeBpmToRange(tempoBpmRaw);
  const energyValence = computeEnergyValence(tempoBpm, rms.mean, features.centroid.mean);
  const vector = buildVector(features, tempoBpm, rms);

  return { features, rms, tempoBpm, tempoBpmRaw, energyValence, vector };
}

module.exports = { extractTextureFeatures, computeEnergyValence };
