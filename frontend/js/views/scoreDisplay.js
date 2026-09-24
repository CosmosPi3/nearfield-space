// Cosine similarity is naturally [-1,1] once vectors are z-score standardized
// (negative = actively opposite of the population average, not just
// "unrelated"). Remapping to [0,1] here is display-only — the stored/cached
// value everywhere else stays the real signed cosine score.
export function toDisplayScore(rawSimilarity) {
  return ((rawSimilarity ?? 0) + 1) / 2;
}
