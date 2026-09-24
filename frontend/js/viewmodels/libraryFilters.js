// Pure helpers for the Library graph's attribute range filters (BPM / views /
// vibe) — no DOM, no store access, so they're trivial to reason about and
// reuse from both the viewmodel and the view's dimming logic.
//
// Filters never remove a node/edge from the graph — they only mark whether a
// node currently matches, which the view uses to dim non-matches. This is
// deliberate: a track outside the selected range might be exactly the
// well-known song a lesser-known, in-range track is connected to, and that
// connection is the whole point of browsing the library graph. Hiding either
// side would erase the very relationship a filter is being used to find.

// Degenerate case (no view-count data, or every track has the same count)
// collapses to a zero-width range rather than throwing — callers disable the
// slider in that case instead of dividing by zero in log-scale math.
export function computeViewsBounds(nodes) {
  let min = null;
  let max = null;
  for (const node of nodes) {
    if (node.viewCount == null) continue;
    if (min === null || node.viewCount < min) min = node.viewCount;
    if (max === null || node.viewCount > max) max = node.viewCount;
  }
  if (min === null) return { min: 0, max: 0 };
  return { min, max };
}

// Fail-open on missing data: a node whose attribute wasn't extracted (still
// null) always counts as matching — a track shouldn't get dimmed just
// because one heuristic feature failed to extract.
function withinRange(value, [lo, hi]) {
  return value == null || (value >= lo && value <= hi);
}

export function nodeMatchesFilters(node, filters) {
  return (
    withinRange(node.tempoBpm, filters.bpm) &&
    withinRange(node.viewCount, filters.views) &&
    withinRange(node.energyValence, filters.vibe)
  );
}
