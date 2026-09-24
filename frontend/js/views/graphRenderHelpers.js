import { toDisplayScore } from './scoreDisplay.js';

// Smaller view count -> bigger node, so underground/small-artist tracks stand
// out visually rather than getting lost next to popular ones. Log-scaled
// since view counts span orders of magnitude; clamped so even huge videos
// stay visible and even tiny ones don't dominate the canvas.
export function nodeSizeValue(node) {
  if (node.viewCount == null) return 4;
  return Math.max(0.2, 8 - Math.log10(node.viewCount + 1));
}

// For the Views filter slider's label — raw toLocaleString() digit grouping
// (as used elsewhere, e.g. NodeDetailPanel) doesn't fit inline next to a
// dual-thumb slider spanning "12" to "4.5M".
const compactNumberFormatter = new Intl.NumberFormat('en', { notation: 'compact' });
export function formatCompactNumber(n) {
  return compactNumberFormatter.format(n);
}

export const NODE_REL_SIZE = 5;
export const IMAGE_OVERFILL = 1.35;
export function nodeRadius(node) {
  return Math.sqrt(nodeSizeValue(node)) * NODE_REL_SIZE;
}

// Thumbnails are lazy-loaded and cached by videoId — nodeCanvasObject runs
// every frame, so we must never construct a new Image() there. Once loaded,
// the force simulation may already have settled (no more automatic redraws),
// so onLoad explicitly triggers one repaint to swap the fallback circle for
// the real image instead of leaving it stuck until some unrelated re-render.
// Shared by every graph view — no reason to double-fetch the same YouTube
// thumbnail for a track that appears in more than one graph.
const thumbnailCache = new Map();
export function getThumbnail(videoId, onLoad) {
  if (!videoId) return null;
  let img = thumbnailCache.get(videoId);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    thumbnailCache.set(videoId, img);
  }
  return img;
}

// Distance is inversely related to similarity — more texturally similar
// tracks pull physically closer together, not just linked. A power curve
// (rather than linear) pushes dissimilar pairs apart more aggressively so
// the graph doesn't visually compress everything into a similar-looking
// cluster.
export const DEFAULT_MIN_LINK_DISTANCE = 100;
export const DEFAULT_MAX_LINK_DISTANCE = 2500;
const DISTANCE_CONTRAST_EXPONENT = 2;

export function distanceForSimilarity(similarity, minDistance, maxDistance) {
  const s = Math.max(0, Math.min(1, toDisplayScore(similarity)));
  const contrast = Math.pow(1 - s, DISTANCE_CONTRAST_EXPONENT);
  return minDistance + contrast * (maxDistance - minDistance);
}

export const MIN_LINK_WIDTH = 0.01;
export const MAX_LINK_WIDTH = 6;

// Remaps the *visible* score range [edgeThreshold, 1] to [MIN_LINK_WIDTH,
// MAX_LINK_WIDTH], rather than the full [0,1] range — otherwise raising the
// min-edge-score slider would hide the thinnest links without the remaining
// ones ever actually reaching MIN_LINK_WIDTH themselves. A link right at the
// current threshold is always the thinnest visible line, whatever that
// threshold is set to.
export function linkWidthForSimilarity(similarity, edgeThreshold) {
  const displayScore = toDisplayScore(similarity);
  const denom = Math.max(1e-6, 1 - edgeThreshold);
  const normalized = Math.max(0, Math.min(1, (displayScore - edgeThreshold) / denom));
  return MIN_LINK_WIDTH + normalized * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
}

// force-graph's default many-body charge (-30, uniform) is weak enough that a
// leaf node's single link can drag it right up against whatever dense
// cluster it's tethered to, reading as part of that cluster's clutter rather
// than as the sparsely-connected node it actually is. Scaling by node radius
// (rather than a flat constant) means bigger/popular nodes — which already
// visually anchor a cluster — push everything around them away harder too,
// so cluster interiors stay legible instead of just spacing out the edges.
export function chargeStrength(node, chargeMultiplier) {
  return chargeMultiplier * nodeRadius(node);
}

// Stronger charge above needs a counterweight, or a node with only one weak
// link can get shoved out toward infinity instead of just clear of whatever
// cluster it doesn't belong in — force-graph's default 'center' force only
// recenters the overall centroid, it doesn't pull individual outliers back.
// Implemented by hand (rather than via a global d3.forceX/forceY) since the
// force-graph bundle doesn't expose the underlying d3-force module.
export function createGravityForce(strength) {
  let nodes = [];
  function force(alpha) {
    for (const node of nodes) {
      node.vx -= node.x * strength * alpha;
      node.vy -= node.y * strength * alpha;
    }
  }
  force.initialize = (ns) => {
    nodes = ns;
  };
  // Mirrors d3-force's own custom-force convention (e.g. forceManyBody().strength())
  // so gravity can be retuned live via graph.d3Force('gravity').strength(value).
  force.strength = (value) => {
    strength = value;
  };
  return force;
}

// force-graph resolves link.source/target from id strings to actual node
// object refs as soon as graphData() is set (d3-force needs real refs) — but
// fall back to a node lookup in case an accessor runs before that.
export function endpointNode(ref, nodeLookup) {
  return typeof ref === 'object' && ref !== null ? ref : nodeLookup.get(ref);
}

export function linkTouchesNode(link, nodeId, nodeLookup) {
  if (nodeId == null) return false;
  return endpointNode(link.source, nodeLookup)?.id === nodeId || endpointNode(link.target, nodeLookup)?.id === nodeId;
}
