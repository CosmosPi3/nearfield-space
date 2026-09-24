import { toDisplayScore } from './scoreDisplay.js';
import {
  nodeSizeValue,
  nodeRadius,
  NODE_REL_SIZE,
  IMAGE_OVERFILL,
  getThumbnail,
  DEFAULT_MIN_LINK_DISTANCE,
  DEFAULT_MAX_LINK_DISTANCE,
  distanceForSimilarity,
  linkWidthForSimilarity,
  chargeStrength,
  createGravityForce,
  linkTouchesNode,
  endpointNode,
  formatCompactNumber,
} from './graphRenderHelpers.js';
import { createRangeSlider } from './RangeSlider.js';
import { nodeMatchesFilters } from '../viewmodels/libraryFilters.js';

const NODE_COLOR = '#5eb4ff';
const NEUTRAL_LINK_COLOR = 'rgba(230,232,238,0.45)';
const HOVERED_LINK_COLOR = 'rgba(255,181,71,0.9)';
const HOVERED_LINK_WIDTH_BOOST = 1.5;
// Attribute filters never remove a node/edge (see libraryFilters.js) — a
// non-matching node is drawn faded instead, so a connection between an
// in-range and an out-of-range track is still visible, not erased along
// with the side that didn't match.
const DIMMED_NODE_ALPHA = 0.25;
const DIMMED_LINK_COLOR = 'rgba(230,232,238,0.08)';
// Deliberately bolder than GraphView's own selection ring (2px/2px padding)
// — the library graph has no seed/discovered color coding to help a node
// stand out, so selection needs to carry more weight on its own here.
const SELECTED_RING_COLOR = 'rgba(255,255,255,0.9)';
const SELECTED_RING_PADDING = 6;
const SELECTED_RING_WIDTH = 3;
const SELECTED_LINK_COLOR = 'rgba(94,180,255,0.75)';
const SELECTED_LINK_WIDTH_BOOST = 1.5;

const DEFAULT_CHARGE_STRENGTH = -50;
const DEFAULT_GRAVITY_STRENGTH = 0.06;
const THRESHOLD_DEBOUNCE_MS = 300;
// A single node's own radius is only a few px at the zoom level the full
// library settles at — this is "close enough to read the node clearly and
// its immediate neighbors" rather than any principled fit-to-node math.
const FOCUS_ZOOM = 1;
const FOCUS_DURATION_MS = 800;

// Every track in the DB, edges only above a similarity threshold — unlike
// GraphView (the workspace exploration graph), there's no seed/discovered/
// status distinction here, so nodes are all drawn the same way. Physics
// (link distance/gravity/repulsion) share the same "Graph options" sliders
// as the workspace graph — initial* params let main.js hand over whatever's
// currently configured there rather than restarting from this view's own
// hardcoded defaults.
export function createLibraryGraphView({
  containerEl,
  libraryGraphViewModel,
  onNodeClick,
  initialLinkDistanceMin = DEFAULT_MIN_LINK_DISTANCE,
  initialLinkDistanceMax = DEFAULT_MAX_LINK_DISTANCE,
  initialChargeStrength = DEFAULT_CHARGE_STRENGTH,
  initialGravity = DEFAULT_GRAVITY_STRENGTH,
}) {
  containerEl.innerHTML = `
    <div class="library-graph-controls">
      <div class="library-graph-status">
        <span class="library-graph-status-line library-graph-status-tracks"></span>
        <span class="library-graph-status-line library-graph-status-edges"></span>
      </div>
      <div class="library-graph-divider"></div>
      <label>
        <span class="range-slider-label">Min similarity <span class="library-threshold-value"></span></span>
        <input type="range" class="library-threshold-input" min="0.5" max="1" step="0.01" />
      </label>
      <div class="range-slider-field">
        <span class="range-slider-label">BPM <span class="range-slider-value bpm-filter-value"></span></span>
        <div class="bpm-filter-slider"></div>
      </div>
      <div class="range-slider-field">
        <span class="range-slider-label">Views <span class="range-slider-value views-filter-value"></span></span>
        <div class="views-filter-slider"></div>
      </div>
      <div class="range-slider-field">
        <span class="range-slider-label">Energy <span class="range-slider-value vibe-filter-value"></span></span>
        <div class="vibe-filter-slider"></div>
      </div>
    </div>
    <div class="library-graph-canvas"></div>
  `;
  const canvasEl = containerEl.querySelector('.library-graph-canvas');
  const thresholdInputEl = containerEl.querySelector('.library-threshold-input');
  const thresholdValueEl = containerEl.querySelector('.library-threshold-value');
  const statusTracksEl = containerEl.querySelector('.library-graph-status-tracks');
  const statusEdgesEl = containerEl.querySelector('.library-graph-status-edges');
  const bpmValueEl = containerEl.querySelector('.bpm-filter-value');
  const viewsValueEl = containerEl.querySelector('.views-filter-value');
  const vibeValueEl = containerEl.querySelector('.vibe-filter-value');

  // Unit/label already appears once in the static "BPM"/"Views"/"Vibe" text
  // next to each slider — these just render the changing numbers.
  const formatBpmRange = (lo, hi) => `${Math.round(lo)} – ${Math.round(hi)}`;
  const formatViewsRange = (lo, hi) => `${formatCompactNumber(lo)} – ${formatCompactNumber(hi)}`;
  const formatVibeRange = (lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`;

  const initialFilters = libraryGraphViewModel.getState().filters;
  const initialViewsBounds = libraryGraphViewModel.getState().viewsBounds;

  const bpmSlider = createRangeSlider({
    containerEl: containerEl.querySelector('.bpm-filter-slider'),
    min: 90,
    max: 180,
    step: 1,
    scale: 'linear',
    values: initialFilters.bpm,
    format: (v) => `${Math.round(v)} BPM`,
    onInput: (lo, hi) => {
      bpmValueEl.textContent = formatBpmRange(lo, hi);
    },
    onChange: (lo, hi) => libraryGraphViewModel.setBpmRange(lo, hi),
  });
  bpmValueEl.textContent = formatBpmRange(...initialFilters.bpm);

  const viewsSlider = createRangeSlider({
    containerEl: containerEl.querySelector('.views-filter-slider'),
    min: initialViewsBounds.min,
    max: initialViewsBounds.max,
    step: 1,
    scale: 'log',
    values: initialFilters.views,
    format: (v) => `${formatCompactNumber(v)} views`,
    onInput: (lo, hi) => {
      viewsValueEl.textContent = formatViewsRange(lo, hi);
    },
    onChange: (lo, hi) => libraryGraphViewModel.setViewsRange(lo, hi),
  });
  viewsValueEl.textContent = formatViewsRange(...initialFilters.views);
  viewsSlider.setDisabled(initialViewsBounds.min === initialViewsBounds.max);

  const vibeSlider = createRangeSlider({
    containerEl: containerEl.querySelector('.vibe-filter-slider'),
    min: 0,
    max: 1,
    step: 0.01,
    scale: 'linear',
    values: initialFilters.vibe,
    format: (v) => v.toFixed(2),
    onInput: (lo, hi) => {
      vibeValueEl.textContent = formatVibeRange(lo, hi);
    },
    onChange: (lo, hi) => libraryGraphViewModel.setVibeRange(lo, hi),
  });
  vibeValueEl.textContent = formatVibeRange(...initialFilters.vibe);

  let lastViewsBoundsKey = `${initialViewsBounds.min}:${initialViewsBounds.max}`;

  let hoveredNodeId = null;
  let selectedNodeId = null;
  let currentThreshold = libraryGraphViewModel.getState().threshold;
  let linkDistanceMin = initialLinkDistanceMin;
  let linkDistanceMax = initialLinkDistanceMax;
  let chargeMultiplier = initialChargeStrength;
  const nodeLookup = new Map();
  // Which node ids currently satisfy the BPM/views/vibe filters — recomputed
  // in render() whenever nodes or filters change, read by the draw callbacks
  // below to decide what to dim. A link only dims when neither endpoint
  // matches, so a bridge from an in-range track out to an out-of-range one
  // (the whole point of browsing by filter) stays visible.
  let matchingIds = new Set();

  function linkIsDimmed(l) {
    const a = endpointNode(l.source, nodeLookup);
    const b = endpointNode(l.target, nodeLookup);
    return !(a && matchingIds.has(a.id)) && !(b && matchingIds.has(b.id));
  }

  // NOT resumeAnimation() — verified from force-graph's own source (v1.51.4):
  // its render loop's trailing requestAnimationFrame() call is unconditional,
  // so once started it runs forever regardless of the simulation's state;
  // resumeAnimation() only does anything if pauseAnimation() was explicitly
  // called first, which this app never does, making it dead code here.
  // What actually gates whether a frame repaints once the simulation has
  // settled is force-graph's internal `needsRedraw` flag — set (with no
  // value-equality check) by re-invoking specific prop setters, of which
  // nodeCanvasObject is one. Passing its own current value back is enough.
  function forceNeedsRedraw() {
    graph.nodeCanvasObject(graph.nodeCanvasObject());
  }

  function repaint() {
    forceNeedsRedraw();
  }

  // needsRedraw is consumed (reset to false) after a single frame, and
  // centerAt/zoom only set it once at call time — so a multi-frame eased
  // transition (their durationMs) needs this re-armed every frame for its
  // whole duration, or the canvas stops advancing partway through and the
  // pan/zoom appears to jump straight to its end state instead of animating.
  function pumpRepaint(ms) {
    const deadline = performance.now() + ms;
    function step() {
      forceNeedsRedraw();
      if (performance.now() < deadline) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setHoveredNodeId(nodeId) {
    hoveredNodeId = nodeId;
    repaint();
  }

  // Driven by LibraryNodePopup opening/closing, not hover — the popup stays
  // open after the pointer moves away, so selection needs its own ring that
  // doesn't depend on hoveredNodeId.
  function setSelectedNodeId(nodeId) {
    selectedNodeId = nodeId;
    repaint();
  }

  const graph = ForceGraph()(canvasEl)
    .backgroundColor('#0b0d12')
    .nodeId('id')
    .nodeLabel('label')
    .nodeVal(nodeSizeValue)
    .nodeRelSize(NODE_REL_SIZE)
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject((node, ctx) => {
      const radius = nodeRadius(node);
      const img = getThumbnail(node.videoId, () => repaint());
      const dimmed = !matchingIds.has(node.id);
      // The canvas context is reused across every node's draw call this
      // frame — reset alpha unconditionally so a previous (possibly dimmed)
      // node's leftover globalAlpha can never bleed into this one's ring.
      ctx.globalAlpha = 1;

      if (node.id === selectedNodeId) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + SELECTED_RING_PADDING, 0, 2 * Math.PI);
        ctx.lineWidth = SELECTED_RING_WIDTH;
        ctx.strokeStyle = SELECTED_RING_COLOR;
        ctx.stroke();
        ctx.restore();
      } else if (node.id === hoveredNodeId) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(94,180,255,0.65)';
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = dimmed ? DIMMED_NODE_ALPHA : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.clip();
        const size = radius * 2 * IMAGE_OVERFILL;
        ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size);
      } else {
        ctx.fillStyle = NODE_COLOR;
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = dimmed ? DIMMED_NODE_ALPHA : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = NODE_COLOR;
      ctx.stroke();
      ctx.restore();
    })
    .nodePointerAreaPaint((node, color, ctx) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius(node), 0, 2 * Math.PI);
      ctx.fill();
    })
    .linkColor((l) => {
      if (linkTouchesNode(l, selectedNodeId, nodeLookup)) return SELECTED_LINK_COLOR;
      if (linkTouchesNode(l, hoveredNodeId, nodeLookup)) return HOVERED_LINK_COLOR;
      return linkIsDimmed(l) ? DIMMED_LINK_COLOR : NEUTRAL_LINK_COLOR;
    })
    .linkWidth((l) => {
      const width = linkWidthForSimilarity(l.cosineScore, toDisplayScore(currentThreshold));
      if (linkTouchesNode(l, selectedNodeId, nodeLookup)) return width + SELECTED_LINK_WIDTH_BOOST;
      return linkTouchesNode(l, hoveredNodeId, nodeLookup) ? width + HOVERED_LINK_WIDTH_BOOST : width;
    })
    .onNodeClick((node, event) => onNodeClick?.(node, event))
    .onNodeHover((node) => setHoveredNodeId(node?.id ?? null));

  graph.d3Force('link').distance((l) => distanceForSimilarity(l.cosineScore, linkDistanceMin, linkDistanceMax));
  graph.d3Force('charge').strength((node) => chargeStrength(node, chargeMultiplier));
  graph.d3Force('gravity', createGravityForce(initialGravity));

  libraryGraphViewModel.subscribe(render);
  render();

  function render() {
    const { nodes, links, viewsBounds, filters, threshold, loading, error } = libraryGraphViewModel.getState();
    currentThreshold = threshold;

    nodeLookup.clear();
    nodes.forEach((n) => nodeLookup.set(n.id, n));
    matchingIds = new Set(nodes.filter((n) => nodeMatchesFilters(n, filters)).map((n) => n.id));
    // graphData() is called with the same nodes/links references on every
    // filter-only change (only threshold changes actually produce new
    // arrays) — nothing about which nodes/links exist has changed, only
    // matchingIds, so the simulation never reheats/repositions just because
    // a filter moved. repaint() alone is enough to redraw with the new
    // dimming.
    graph.graphData({ nodes, links });
    repaint();

    thresholdInputEl.value = threshold;
    thresholdValueEl.textContent = threshold.toFixed(2);
    if (loading) {
      statusTracksEl.textContent = 'Loading…';
      statusEdgesEl.textContent = '';
    } else if (error) {
      statusTracksEl.textContent = `Error: ${error}`;
      statusEdgesEl.textContent = '';
    } else {
      statusTracksEl.textContent = `${matchingIds.size} of ${nodes.length} tracks`;
      statusEdgesEl.textContent = `${links.length} edges`;
    }

    const viewsBoundsKey = `${viewsBounds.min}:${viewsBounds.max}`;
    if (viewsBoundsKey !== lastViewsBoundsKey) {
      lastViewsBoundsKey = viewsBoundsKey;
      // setBounds() alone would just clamp whatever the slider happened to
      // be showing before (e.g. its [0,0] construction-time default) into
      // the new range, which isn't necessarily the viewmodel's actual
      // filters.views — setValues() makes the slider mirror the real
      // selection explicitly, the one time bounds shift out from under it.
      viewsSlider.setBounds(viewsBounds.min, viewsBounds.max, { clampValues: false });
      viewsSlider.setValues(filters.views[0], filters.views[1]);
      viewsSlider.setDisabled(viewsBounds.min === viewsBounds.max);
      viewsValueEl.textContent = formatViewsRange(...filters.views);
    }
  }

  function resize() {
    graph.width(canvasEl.clientWidth).height(canvasEl.clientHeight);
  }

  window.addEventListener('resize', resize);
  resize();

  let debounceTimer = null;
  thresholdInputEl.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    thresholdValueEl.textContent = value.toFixed(2);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => libraryGraphViewModel.setThreshold(value), THRESHOLD_DEBOUNCE_MS);
  });

  // Mirrors GraphView's setters — driven by the same "Graph options" sliders
  // in main.js, so tuning physics affects whichever graph is open.
  function setLinkDistanceRange(min, max) {
    linkDistanceMin = min;
    linkDistanceMax = max;
    graph.d3Force('link').distance((l) => distanceForSimilarity(l.cosineScore, linkDistanceMin, linkDistanceMax));
    graph.d3ReheatSimulation();
  }

  function setChargeStrength(value) {
    chargeMultiplier = value;
    graph.d3Force('charge').strength((node) => chargeStrength(node, chargeMultiplier));
    graph.d3ReheatSimulation();
  }

  function setGravity(value) {
    graph.d3Force('gravity').strength(value);
    graph.d3ReheatSimulation();
  }

  // Reads from force-graph's own live graphData() rather than
  // libraryGraphViewModel's state — guarantees the x/y the simulation is
  // actually using right now, whether or not the source node objects are
  // the same references.
  function centerOnNode(nodeId, zoom = FOCUS_ZOOM) {
    const focus = () => {
      const node = graph.graphData().nodes.find((n) => n.id === nodeId);
      if (node) {
        graph.centerAt(node.x, node.y, FOCUS_DURATION_MS);
        graph.zoom(zoom, FOCUS_DURATION_MS);
        // centerAt/zoom's eased transition only advances on frames the
        // canvas actually redraws — but force-graph pauses its own render
        // loop once the simulation has cooled down (that's why repaint()
        // above exists at all). Without this, the transition's target is
        // set correctly but never gets painted until something unrelated
        // (e.g. dragging the graph) forces a redraw, at which point it
        // jumps straight to the already-elapsed end state instead of
        // visibly animating.
        pumpRepaint(FOCUS_DURATION_MS);
      }
    };
    focus(); // already correct if the simulation has settled (e.g. this tab was visited earlier this session)
    // On a brand-new graph, d3-force keeps moving every node's x/y for a
    // couple seconds after graphData() first sets them (the simulation is
    // still actively cooling), so the immediate focus() above lands on a
    // position the node then drifts away from — this is exactly the "first
    // load of the session" case. Re-focusing once more when the engine
    // actually settles catches up to wherever it ends up. Self-clearing so
    // this one-shot doesn't linger and fire on some later, unrelated reheat
    // (e.g. a physics-slider change).
    graph.onEngineStop(() => {
      focus();
      graph.onEngineStop(() => {});
    });
  }

  return { resize, setLinkDistanceRange, setChargeStrength, setGravity, centerOnNode, setSelectedNodeId };
}
