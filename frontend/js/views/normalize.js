// Maps a friendly 0-100 slider scale to/from a parameter's real internal
// units (pixels, d3-force alpha multipliers, etc) — same split as
// scoreDisplay.js's toDisplayScore, just linear instead of a cosine remap.
export function fromNormalized(normalized, min, max) {
  return min + (normalized / 100) * (max - min);
}

export function toNormalized(value, min, max) {
  return ((value - min) / (max - min)) * 100;
}
