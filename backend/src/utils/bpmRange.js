const { BPM_RANGE_MIN, BPM_RANGE_MAX } = require('../config');

const MAX_FOLD_ITERATIONS = 20;

// Rekordbox-style tempo folding: repeatedly double/halve a detected BPM until
// it lands in [min, max]. A single alternating loop, not two sequential
// while-loops — for a non-octave range (max != min*2), doubling then halving
// separately can overshoot back out of range and silently return a wrong
// value. The final clamp is a fallback for that case, not the primary path.
function normalizeBpmToRange(bpm, min = BPM_RANGE_MIN, max = BPM_RANGE_MAX) {
  if (!Number.isFinite(bpm) || bpm <= 0) return bpm;
  let v = bpm;
  for (let i = 0; i < MAX_FOLD_ITERATIONS; i++) {
    if (v < min) v *= 2;
    else if (v > max) v /= 2;
    else return v;
  }
  return Math.max(min, Math.min(max, v));
}

module.exports = { normalizeBpmToRange };
