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
  MIN_LINK_WIDTH,
  MAX_LINK_WIDTH,
  linkWidthForSimilarity,
  chargeStrength,
  createGravityForce,
  endpointNode,
  linkTouchesNode,
} from './graphRenderHelpers.js';

const NODE_COLORS = {
  seed: '#5eb4ff',
  discovered: '#8b93a3',
};
const STATUS_OVERRIDE_COLORS = {
  pending: '#4a4f5c',
  unavailable: '#4a4f5c',
  error: '#e0616b',
};
// Color is driven by whether an edge touches a pinned track, not by edge
// type — matches the seed node color so a pinned track's edges visually
// "glow" the same blue as the node itself. Everything else (including deep
// discovered-via edges that don't reach a seed) is a neutral near-white.
const SEED_LINK_COLOR = 'rgba(94,180,255,0.75)';
const NEUTRAL_LINK_COLOR = 'rgba(230,232,238,0.45)';

// force-graph's default many-body charge (-30, uniform) is too weak at this
// view's scale — see chargeStrength in graphRenderHelpers.js.
const DEFAULT_CHARGE_STRENGTH = -50;
const DEFAULT_GRAVITY_STRENGTH = 0.06;
// A single node's own radius is only a few px at the zoom level the graph
// settles at — this is "close enough to read the node clearly and its
// immediate neighbors" rather than any principled fit-to-node math. Mirrors
// LibraryGraphView's own FOCUS_ZOOM/FOCUS_DURATION_MS.
const FOCUS_ZOOM = 1;
const FOCUS_DURATION_MS = 800;

function touchesPinnedNode(link, graphState) {
  return endpointNode(link.source, graphState.nodes)?.kind === 'seed' || endpointNode(link.target, graphState.nodes)?.kind === 'seed';
}

// Selection ring sits outside the node's own border so it reads as a halo
// rather than competing with the border's status/kind color.
const SELECTED_RING_COLOR = 'rgba(94,180,255,0.65)';
const SELECTED_RING_PADDING = 2;
const SELECTED_RING_WIDTH = 5.5;

// Softer/dimmer than the selection ring so hovering a list item never reads
// as "this is now selected" — it's just a preview.
const HOVERED_RING_COLOR = 'rgba(255,181,71,0.65)';
const HOVERED_RING_PADDING = 4;
const HOVERED_RING_WIDTH = 1.5;

// Deliberately not the same blue as SEED_LINK_COLOR — a hovered edge and a
// pinned-track edge are different facts about a link, and sharing a color
// would make it ambiguous which one a highlighted edge is signaling.
const HOVERED_LINK_COLOR = 'rgba(255,181,71,0.9)';
const HOVERED_LINK_WIDTH_BOOST = 1.5;

export function createGraphView({
  containerEl,
  graphViewModel,
  onNodeClick,
  initialEdgeThreshold = 0.5,
  initialLinkDistanceMin = DEFAULT_MIN_LINK_DISTANCE,
  initialLinkDistanceMax = DEFAULT_MAX_LINK_DISTANCE,
  initialChargeStrength = DEFAULT_CHARGE_STRENGTH,
  initialGravity = DEFAULT_GRAVITY_STRENGTH,
}) {
  // Display-scale (0-1) cutoff — links scoring below this are hidden
  // entirely, not just faded, so a high threshold genuinely declutters the
  // graph down to only the strongest relationships.
  let edgeThreshold = initialEdgeThreshold;
  let linkDistanceMin = initialLinkDistanceMin;
  let linkDistanceMax = initialLinkDistanceMax;
  let chargeMultiplier = initialChargeStrength;
  let selectedNodeId = null;
  let hoveredNodeId = null;

  const graph = ForceGraph()(containerEl)
    .backgroundColor('#0b0d12')
    .nodeId('id')
    .nodeLabel('label')
    .nodeVal(nodeSizeValue)
    .nodeRelSize(NODE_REL_SIZE)
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject((node, ctx) => {
      const radius = nodeRadius(node);
      const borderColor = STATUS_OVERRIDE_COLORS[node.status] || NODE_COLORS[node.kind] || NODE_COLORS.discovered;
      const img = getThumbnail(node.videoId, () => repaint());

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
        ctx.arc(node.x, node.y, radius + HOVERED_RING_PADDING, 0, 2 * Math.PI);
        ctx.lineWidth = HOVERED_RING_WIDTH;
        ctx.strokeStyle = HOVERED_RING_COLOR;
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.clip();
        // Overfill rather than fit-exact — any antialiasing at the circular
        // clip edge would otherwise let the dark background peek through as
        // a thin ring. Cropping more of the thumbnail is an acceptable trade.
        const size = radius * 2 * IMAGE_OVERFILL;
        ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size);
      } else {
        ctx.fillStyle = borderColor;
        ctx.fill();
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = borderColor;
      ctx.stroke();
    })
    .nodePointerAreaPaint((node, color, ctx) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius(node), 0, 2 * Math.PI);
      ctx.fill();
    })
    .linkColor((l) =>
      linkTouchesNode(l, hoveredNodeId, graphViewModel.graphState.nodes)
        ? HOVERED_LINK_COLOR
        : touchesPinnedNode(l, graphViewModel.graphState) ? SEED_LINK_COLOR : NEUTRAL_LINK_COLOR
    )
    .linkWidth((l) => {
      const width = linkWidthForSimilarity(l.similarity, edgeThreshold);
      return linkTouchesNode(l, hoveredNodeId, graphViewModel.graphState.nodes) ? width + HOVERED_LINK_WIDTH_BOOST : width;
    })
    .linkCanvasObjectMode(() => 'after')
    .linkCanvasObject((link, ctx, globalScale) => {
      if (link.similarity == null) return;
      // Only the currently-selected node's own edges get their score printed
      // — showing every visible link's number at once gets noisy fast as the
      // graph grows, and the selected node is already the one thing the user
      // is focused on.
      if (!linkTouchesNode(link, selectedNodeId, graphViewModel.graphState.nodes)) return;
      const { source, target } = link;
      if (typeof source !== 'object' || typeof target !== 'object') return;
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const fontSize = 12 / globalScale;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = 'rgba(230,232,238,0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(toDisplayScore(link.similarity).toFixed(2), midX, midY);
    })
    .onNodeClick((node, event) => onNodeClick?.(node, event))
    .onNodeHover((node) => setHoveredNodeId(node?.id ?? null));

  graph.d3Force('link').distance((l) => distanceForSimilarity(l.similarity, linkDistanceMin, linkDistanceMax));
  graph.d3Force('charge').strength((node) => chargeStrength(node, chargeMultiplier));
  graph.d3Force('gravity', createGravityForce(initialGravity));

  graphViewModel.subscribe(render);
  render();

  // Links below the threshold are excluded from the data handed to the
  // simulation entirely (not just hidden via linkVisibility) — otherwise a
  // filtered-out link still pulls its endpoints via d3-force's link
  // distance, so raising the slider wouldn't actually let unrelated nodes
  // drift apart, it'd just stop drawing the line still holding them together.
  function render() {
    const { nodes, links } = graphViewModel.getGraphData();
    const visibleLinks = links.filter((l) => toDisplayScore(l.similarity) >= edgeThreshold);
    graph.graphData({ nodes, links: visibleLinks });
  }

  function resize() {
    graph.width(containerEl.clientWidth).height(containerEl.clientHeight);
  }

  window.addEventListener('resize', resize);
  resize();

  function setEdgeThreshold(value) {
    edgeThreshold = value;
    render(); // force a repaint — the sim may have already settled otherwise
  }

  // Distance/charge/gravity changes reheat the existing simulation in place
  // (rather than going through render()/graphData()) so nodes ease into the
  // new layout instead of jump-cutting — graphData() treats any call as a
  // fresh dataset and resets positions, d3ReheatSimulation() doesn't.
  function setLinkDistanceRange(min, max) {
    linkDistanceMin = min;
    linkDistanceMax = max;
    graph.d3Force('link').distance((l) => distanceForSimilarity(l.similarity, linkDistanceMin, linkDistanceMax));
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

  // Repaint (not render()/graphData()) — selection/hover only change how
  // existing nodes/links are drawn, not the data itself. graphData() resupplies
  // the simulation with a fresh nodes/links payload, which force-graph treats
  // as a real data change and reheats (resets alpha) — with the stronger
  // charge/gravity forces added for clustering, that reheat visibly jitters
  // nodes away from the cursor on every hover.
  //
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

  function setSelectedNodeId(nodeId) {
    selectedNodeId = nodeId;
    repaint();
  }

  function setHoveredNodeId(nodeId) {
    hoveredNodeId = nodeId;
    repaint();
  }

  // Reads from force-graph's own live graphData() rather than graphState —
  // guarantees the x/y the simulation is actually using right now, whether
  // or not the source node objects are the same references.
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
    focus(); // already correct if the graph has settled (e.g. reused across an earlier session)
    // A brand-new/just-grown graph keeps moving every node's x/y for a
    // couple seconds after graphData() first sets them (the simulation is
    // still actively cooling), so the immediate focus() above lands on a
    // position the node then drifts away from — most likely right after a
    // fresh "Add to workspace" cross-tab jump. Re-focusing once more when
    // the engine actually settles catches up to wherever it ends up.
    // Self-clearing so this one-shot doesn't linger and fire on some later,
    // unrelated reheat (e.g. a physics-slider change or a Discover run).
    graph.onEngineStop(() => {
      focus();
      graph.onEngineStop(() => {});
    });
  }

  return { resize, setEdgeThreshold, setLinkDistanceRange, setChargeStrength, setGravity, setSelectedNodeId, setHoveredNodeId, centerOnNode };
}
