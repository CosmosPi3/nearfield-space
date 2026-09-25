import { createSearchViewModel } from './viewmodels/SearchViewModel.js';
import { createGraphViewModel } from './viewmodels/GraphViewModel.js';
import { createLibraryGraphViewModel } from './viewmodels/LibraryGraphViewModel.js';
import { createLibrarySearchViewModel } from './viewmodels/LibrarySearchViewModel.js';
import { createSearchView } from './views/SearchView.js';
import { createLibrarySearchView } from './views/LibrarySearchView.js';
import { createSeedListView } from './views/SeedListView.js';
import { createGraphView } from './views/GraphView.js';
import { createLibraryGraphView } from './views/LibraryGraphView.js';
import { createLibraryNodePopup } from './views/LibraryNodePopup.js';
import { createNodeDetailPanel } from './views/NodeDetailPanel.js';
import { createDiscoverProgressView } from './views/DiscoverProgressView.js';
import { createTopSimilarView } from './views/TopSimilarView.js';
import { setupInfoTooltips } from './views/infoTooltip.js';
import { fromNormalized, toNormalized } from './views/normalize.js';

// Reads a persisted number, falling back to `defaultValue` if unset/invalid —
// shared by every slider in the settings sheet so each one only needs to
// supply its own storage key/default, not reimplement the parse/fallback.
function readPersistedNumber(storageKey, defaultValue) {
  const stored = parseFloat(localStorage.getItem(storageKey));
  return Number.isFinite(stored) ? stored : defaultValue;
}

const SEARCH_INPUT_PLACEHOLDER = 'Search, or paste a link…';
const LIBRARY_SEARCH_INPUT_PLACEHOLDER = 'Search the library by artist or track…';

const searchInputEl = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');

const searchViewModel = createSearchViewModel();
const graphViewModel = createGraphViewModel();
await graphViewModel.hydrate(); // restore the persisted workspace before anything renders

const searchView = createSearchView({
  inputEl: searchInputEl,
  dropdownEl: searchResultsEl,
  searchViewModel,
  // Adds the track to the graph without pinning it, and opens its popup
  // immediately (in "Loading features…" state — the panel re-renders
  // reactively once extraction finishes). Pinning is now an explicit choice
  // via the popup's Pin button, not automatic on search-select.
  onSelect: (track) => {
    graphViewModel.addTrack(track);
    nodeDetailPanel.open(track);
  },
  onManualAdd: (url) => {
    graphViewModel.addManualTrack(url);
    nodeDetailPanel.open({ id: `manual:${url}` });
  },
});

// Assigned once createGraphView runs below — these callbacks are only ever
// invoked later, from a user click/hover, by which point this is set.
let graphView;

// Remembers whichever node was last open in each tab so switching tabs and
// back reopens it, instead of leaving both panels closed. Only updated on a
// non-null selection (a close shouldn't erase what to reopen next time).
let lastWorkspaceNodeId = null;
let lastLibraryNodeId = null;

createSeedListView({
  listEl: document.getElementById('seed-tracks-list'),
  graphViewModel,
  onItemClick: (node) => nodeDetailPanel.open(node),
  onItemHover: (nodeId) => graphView.setHoveredNodeId(nodeId),
});

const nodeDetailPanel = createNodeDetailPanel({
  panelEl: document.getElementById('node-detail-panel'),
  graphViewModel,
  branchingInputEl: document.getElementById('branching-input'),
  depthInputEl: document.getElementById('depth-input'),
  onSelectionChange: (nodeId) => {
    graphView.setSelectedNodeId(nodeId);
    if (nodeId != null) lastWorkspaceNodeId = nodeId;
  },
  onItemHover: (nodeId) => graphView.setHoveredNodeId(nodeId),
  onViewInLibrary: (nodeId) => viewInLibrary(nodeId),
});

createDiscoverProgressView({
  el: document.getElementById('discover-progress-overlay'),
  graphViewModel,
});

const branchingValueEl = document.getElementById('branching-value');
document.getElementById('branching-input').addEventListener('input', (e) => {
  branchingValueEl.textContent = e.target.value;
});

// Depth is only ever read at Discover-click time (see NodeDetailPanel), not
// by the graph itself, so — unlike the physics sliders below — it doesn't
// need to be resolved before graphView is created.
const DEPTH_STORAGE_KEY = 'nearfieldspace:depth';
const DEFAULT_DEPTH = 1;
const depthInputEl = document.getElementById('depth-input');
const depthValueEl = document.getElementById('depth-value');
const initialDepth = readPersistedNumber(DEPTH_STORAGE_KEY, DEFAULT_DEPTH);
depthInputEl.value = initialDepth;
depthValueEl.textContent = initialDepth;
depthInputEl.addEventListener('input', (e) => {
  depthValueEl.textContent = e.target.value;
  localStorage.setItem(DEPTH_STORAGE_KEY, e.target.value);
});

setupInfoTooltips();

// --- Graph options: min edge score + physics sliders ------------------------
// All resolved from localStorage (or their default) before graphView is
// created, so the initial render honors them instead of momentarily showing
// force-graph/d3-force's own defaults before these listeners attach.
const EDGE_THRESHOLD_STORAGE_KEY = 'nearfieldspace:edgeThreshold';
const DEFAULT_EDGE_THRESHOLD = 0.5;
const LINK_DISTANCE_MIN_STORAGE_KEY = 'nearfieldspace:linkDistanceMin';
const LINK_DISTANCE_MAX_STORAGE_KEY = 'nearfieldspace:linkDistanceMax';
const GRAVITY_STORAGE_KEY = 'nearfieldspace:gravity';
const CHARGE_STORAGE_KEY = 'nearfieldspace:charge';

// Friendly 0-100 slider scales, mapped to GraphView's real d3-force units via
// normalize.js. Defaults are chosen so an untouched slider reproduces
// GraphView's own hardcoded defaults (100px / 2500px / 0.06 / charge
// multiplier -50).
const LINK_DISTANCE_MIN_RANGE = [5, 1000];
const LINK_DISTANCE_MAX_RANGE = [100, 10000];
const GRAVITY_RANGE = [0, 0.3];
const CHARGE_RANGE = [0, 150]; // stored/displayed as a positive "repulsion" value, negated for GraphView

const DEFAULT_LINK_DISTANCE_MIN_NORM = Math.round(toNormalized(100, ...LINK_DISTANCE_MIN_RANGE));
const DEFAULT_LINK_DISTANCE_MAX_NORM = Math.round(toNormalized(2500, ...LINK_DISTANCE_MAX_RANGE));
const DEFAULT_GRAVITY_NORM = Math.round(toNormalized(0.06, ...GRAVITY_RANGE));
const DEFAULT_CHARGE_NORM = Math.round(toNormalized(50, ...CHARGE_RANGE));

const edgeThresholdInputEl = document.getElementById('edge-threshold-input');
const edgeThresholdValueEl = document.getElementById('edge-threshold-value');
const linkDistanceMinInputEl = document.getElementById('link-distance-min-input');
const linkDistanceMinValueEl = document.getElementById('link-distance-min-value');
const linkDistanceMaxInputEl = document.getElementById('link-distance-max-input');
const linkDistanceMaxValueEl = document.getElementById('link-distance-max-value');
const gravityInputEl = document.getElementById('gravity-input');
const gravityValueEl = document.getElementById('gravity-value');
const chargeInputEl = document.getElementById('charge-input');
const chargeValueEl = document.getElementById('charge-value');

const initialEdgeThreshold = readPersistedNumber(EDGE_THRESHOLD_STORAGE_KEY, DEFAULT_EDGE_THRESHOLD);
const initialLinkDistanceMinNorm = readPersistedNumber(LINK_DISTANCE_MIN_STORAGE_KEY, DEFAULT_LINK_DISTANCE_MIN_NORM);
const initialLinkDistanceMaxNorm = readPersistedNumber(LINK_DISTANCE_MAX_STORAGE_KEY, DEFAULT_LINK_DISTANCE_MAX_NORM);
const initialGravityNorm = readPersistedNumber(GRAVITY_STORAGE_KEY, DEFAULT_GRAVITY_NORM);
const initialChargeNorm = readPersistedNumber(CHARGE_STORAGE_KEY, DEFAULT_CHARGE_NORM);

edgeThresholdInputEl.value = initialEdgeThreshold;
edgeThresholdValueEl.textContent = initialEdgeThreshold.toFixed(2);
linkDistanceMinInputEl.value = initialLinkDistanceMinNorm;
linkDistanceMinValueEl.textContent = initialLinkDistanceMinNorm;
linkDistanceMaxInputEl.value = initialLinkDistanceMaxNorm;
linkDistanceMaxValueEl.textContent = initialLinkDistanceMaxNorm;
gravityInputEl.value = initialGravityNorm;
gravityValueEl.textContent = initialGravityNorm;
chargeInputEl.value = initialChargeNorm;
chargeValueEl.textContent = initialChargeNorm;

graphView = createGraphView({
  containerEl: document.getElementById('graph-container'),
  graphViewModel,
  onNodeClick: (node) => nodeDetailPanel.open(node),
  initialEdgeThreshold,
  initialLinkDistanceMin: fromNormalized(initialLinkDistanceMinNorm, ...LINK_DISTANCE_MIN_RANGE),
  initialLinkDistanceMax: fromNormalized(initialLinkDistanceMaxNorm, ...LINK_DISTANCE_MAX_RANGE),
  initialGravity: fromNormalized(initialGravityNorm, ...GRAVITY_RANGE),
  initialChargeStrength: -fromNormalized(initialChargeNorm, ...CHARGE_RANGE),
});

// force-graph replaces #graph-container's own DOM on construction above, so
// the overlay has to be appended after the fact rather than living inside it
// in index.html — this way it's a real child, positioned relative to the
// container instead of needing to reverse-engineer the grid's cell geometry.
document.getElementById('graph-container').appendChild(document.getElementById('discover-progress-overlay'));

edgeThresholdInputEl.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  edgeThresholdValueEl.textContent = value.toFixed(2);
  localStorage.setItem(EDGE_THRESHOLD_STORAGE_KEY, value);
  graphView.setEdgeThreshold(value);
});

// Both ends of the link-distance range feed a single GraphView call, so
// either slider's listener re-reads both current DOM values rather than
// tracking min/max independently. Also drives libraryGraphView (constructed
// eagerly at boot, see below) so the same "Graph options" sliders tune
// whichever graph is open.
function applyLinkDistanceRange() {
  const min = fromNormalized(parseFloat(linkDistanceMinInputEl.value), ...LINK_DISTANCE_MIN_RANGE);
  const max = fromNormalized(parseFloat(linkDistanceMaxInputEl.value), ...LINK_DISTANCE_MAX_RANGE);
  graphView.setLinkDistanceRange(min, max);
  libraryGraphView.setLinkDistanceRange(min, max);
}

linkDistanceMinInputEl.addEventListener('input', (e) => {
  linkDistanceMinValueEl.textContent = e.target.value;
  localStorage.setItem(LINK_DISTANCE_MIN_STORAGE_KEY, e.target.value);
  applyLinkDistanceRange();
});

linkDistanceMaxInputEl.addEventListener('input', (e) => {
  linkDistanceMaxValueEl.textContent = e.target.value;
  localStorage.setItem(LINK_DISTANCE_MAX_STORAGE_KEY, e.target.value);
  applyLinkDistanceRange();
});

gravityInputEl.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  gravityValueEl.textContent = value;
  localStorage.setItem(GRAVITY_STORAGE_KEY, value);
  const gravity = fromNormalized(value, ...GRAVITY_RANGE);
  graphView.setGravity(gravity);
  libraryGraphView.setGravity(gravity);
});

chargeInputEl.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  chargeValueEl.textContent = value;
  localStorage.setItem(CHARGE_STORAGE_KEY, value);
  const chargeStrength = -fromNormalized(value, ...CHARGE_RANGE);
  graphView.setChargeStrength(chargeStrength);
  libraryGraphView.setChargeStrength(chargeStrength);
});

document.getElementById('graph-options-reset-button').addEventListener('click', () => {
  const resets = [
    [edgeThresholdInputEl, edgeThresholdValueEl, EDGE_THRESHOLD_STORAGE_KEY, DEFAULT_EDGE_THRESHOLD, (v) => v.toFixed(2)],
    [linkDistanceMinInputEl, linkDistanceMinValueEl, LINK_DISTANCE_MIN_STORAGE_KEY, DEFAULT_LINK_DISTANCE_MIN_NORM, (v) => v],
    [linkDistanceMaxInputEl, linkDistanceMaxValueEl, LINK_DISTANCE_MAX_STORAGE_KEY, DEFAULT_LINK_DISTANCE_MAX_NORM, (v) => v],
    [gravityInputEl, gravityValueEl, GRAVITY_STORAGE_KEY, DEFAULT_GRAVITY_NORM, (v) => v],
    [chargeInputEl, chargeValueEl, CHARGE_STORAGE_KEY, DEFAULT_CHARGE_NORM, (v) => v],
  ];
  for (const [inputEl, valueEl, storageKey, defaultValue, format] of resets) {
    inputEl.value = defaultValue;
    valueEl.textContent = format(defaultValue);
    localStorage.setItem(storageKey, defaultValue);
  }
  graphView.setEdgeThreshold(DEFAULT_EDGE_THRESHOLD);
  applyLinkDistanceRange();
  const gravity = fromNormalized(DEFAULT_GRAVITY_NORM, ...GRAVITY_RANGE);
  const chargeStrength = -fromNormalized(DEFAULT_CHARGE_NORM, ...CHARGE_RANGE);
  graphView.setGravity(gravity);
  graphView.setChargeStrength(chargeStrength);
  libraryGraphView.setGravity(gravity);
  libraryGraphView.setChargeStrength(chargeStrength);
});

createTopSimilarView({
  listEl: document.getElementById('top-similar-list'),
  graphViewModel,
  onItemClick: (node) => nodeDetailPanel.open(node),
  onItemHover: (nodeId) => graphView.setHoveredNodeId(nodeId),
});

document.getElementById('reset-graph-button').addEventListener('click', () => {
  graphViewModel.resetGraph();
});

// Mobile-only hamburger toggles (the buttons themselves are hidden via CSS
// on desktop, so these listeners are just unreachable there, not disabled) —
// collapses everything in #top-bar/#sidebar except the toggle button
// itself, per style.css's `.collapsed` rules, freeing the graph's vertical
// space on a small screen.
function setupMobileMenuToggle(toggleId, targetId) {
  const toggleEl = document.getElementById(toggleId);
  const targetEl = document.getElementById(targetId);
  toggleEl.addEventListener('click', () => {
    const collapsed = targetEl.classList.toggle('collapsed');
    toggleEl.setAttribute('aria-expanded', String(!collapsed));
  });
}
setupMobileMenuToggle('topbar-toggle-button', 'top-bar');
setupMobileMenuToggle('sidebar-toggle-button', 'sidebar');

const helpModalOverlayEl = document.getElementById('help-modal-overlay');
document.getElementById('help-button').addEventListener('click', () => {
  helpModalOverlayEl.classList.remove('hidden');
});
document.getElementById('help-modal-close').addEventListener('click', () => {
  helpModalOverlayEl.classList.add('hidden');
});
helpModalOverlayEl.addEventListener('click', (e) => {
  if (e.target === helpModalOverlayEl) helpModalOverlayEl.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') helpModalOverlayEl.classList.add('hidden');
});

// Non-modal by design — the sheet is for live-tuning sliders while watching
// the graph react, so nothing else on the page should be blocked or need
// dismissing it first. Only the pull tab itself and Escape close it.
const settingsSheetEl = document.getElementById('settings-sheet');
const settingsPullTabEl = document.getElementById('settings-pull-tab');

function setSettingsSheetOpen(open) {
  settingsSheetEl.classList.toggle('open', open);
  settingsPullTabEl.setAttribute('aria-expanded', String(open));
}

settingsPullTabEl.addEventListener('click', () => {
  setSettingsSheetOpen(!settingsSheetEl.classList.contains('open'));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setSettingsSheetOpen(false);
});

// --- Library tab: every track in the DB, edges above a similarity threshold -
const libraryGraphViewModel = createLibraryGraphViewModel();
const libraryNodePopup = createLibraryNodePopup({
  panelEl: document.getElementById('library-node-panel'),
  libraryGraphViewModel,
  onAddToWorkspace: async (node) => {
    await graphViewModel.addTrack(node); // no-op if already present; otherwise persists + loads features
    showWorkspaceTab(); // closes libraryNodePopup
    nodeDetailPanel.open({ id: node.id });
    graphView.centerOnNode(node.id);
  },
  onSelectionChange: (nodeId) => {
    libraryGraphView.setSelectedNodeId(nodeId);
    if (nodeId != null) lastLibraryNodeId = nodeId;
  },
});

const workspaceTabButton = document.getElementById('tab-workspace-button');
const libraryTabButton = document.getElementById('tab-library-button');
const sidebarEl = document.getElementById('sidebar');
const workspaceGraphEl = document.getElementById('graph-container');
const libraryContainerEl = document.getElementById('library-container');
const resetGraphButtonEl = document.getElementById('reset-graph-button');

// Constructed eagerly at boot, not lazily on first tab switch — otherwise
// its force-graph simulation is still actively cooling (repositioning every
// node) right when a fresh "View in library"/search-select centerOnNode
// call needs a settled position to land on. #library-container stays
// present-but-invisible via visibility:hidden while inactive specifically
// so it already has real dimensions for force-graph to size against here —
// see style.css.
const libraryGraphView = createLibraryGraphView({
  containerEl: libraryContainerEl,
  libraryGraphViewModel,
  onNodeClick: (node) => libraryNodePopup.open(node),
  initialLinkDistanceMin: fromNormalized(parseFloat(linkDistanceMinInputEl.value), ...LINK_DISTANCE_MIN_RANGE),
  initialLinkDistanceMax: fromNormalized(parseFloat(linkDistanceMaxInputEl.value), ...LINK_DISTANCE_MAX_RANGE),
  initialGravity: fromNormalized(parseFloat(gravityInputEl.value), ...GRAVITY_RANGE),
  initialChargeStrength: -fromNormalized(parseFloat(chargeInputEl.value), ...CHARGE_RANGE),
});
libraryGraphViewModel.load();

const librarySearchViewModel = createLibrarySearchViewModel({ libraryGraphViewModel });
const librarySearchView = createLibrarySearchView({
  inputEl: searchInputEl,
  dropdownEl: searchResultsEl,
  librarySearchViewModel,
  onSelect: (node) => {
    libraryNodePopup.open(node);
    libraryGraphView.centerOnNode(node.id);
  },
});

// Set whenever a track lands in the backend's tracks table while the Library
// tab isn't the one on screen — cheaper than re-fetching a graph nobody's
// looking at; caught up on next switch into the tab instead.
let libraryStale = false;

graphViewModel.onLibraryChange(() => {
  if (libraryTabButton.classList.contains('active')) {
    libraryGraphViewModel.load();
  } else {
    libraryStale = true;
  }
});

// The search input/dropdown and the Reset Graph button are shared chrome in
// #top-bar (outside either tab's own container), so switching tabs has to
// explicitly hand them off rather than relying on the containers' own
// hidden/visible toggling.
function setSearchMode(mode) {
  searchInputEl.value = '';
  searchInputEl.placeholder = mode === 'library' ? LIBRARY_SEARCH_INPUT_PLACEHOLDER : SEARCH_INPUT_PLACEHOLDER;
  searchViewModel.clear();
  librarySearchViewModel.clear();
  searchView.setActive(mode === 'workspace');
  librarySearchView.setActive(mode === 'library');
}

function showWorkspaceTab() {
  workspaceTabButton.classList.add('active');
  libraryTabButton.classList.remove('active');
  sidebarEl.classList.remove('hidden');
  workspaceGraphEl.classList.remove('hidden');
  libraryContainerEl.classList.add('hidden');
  resetGraphButtonEl.classList.remove('hidden');
  setSearchMode('workspace');
  // Otherwise a node selected in the Library tab stays open, floating over
  // the Discovery sidebar until manually closed.
  libraryNodePopup.close();
}

async function showLibraryTab() {
  workspaceTabButton.classList.remove('active');
  libraryTabButton.classList.add('active');
  sidebarEl.classList.add('hidden');
  workspaceGraphEl.classList.add('hidden');
  libraryContainerEl.classList.remove('hidden');
  resetGraphButtonEl.classList.add('hidden'); // Reset Graph only makes sense for the Discovery workspace
  setSearchMode('library');
  nodeDetailPanel.close();

  libraryGraphView.resize(); // container may have been resized by the window while it was visibility:hidden
  if (libraryStale) {
    libraryStale = false;
    await libraryGraphViewModel.load();
  }
}

workspaceTabButton.addEventListener('click', () => {
  showWorkspaceTab();
  // Reopen whatever was open last time this tab was active — workspace
  // nodes are already in memory (no load to await), so this can happen
  // synchronously right after the tab switch.
  if (lastWorkspaceNodeId && graphViewModel.graphState.nodes.has(lastWorkspaceNodeId)) {
    nodeDetailPanel.open({ id: lastWorkspaceNodeId });
  }
});
libraryTabButton.addEventListener('click', async () => {
  await showLibraryTab(); // must wait for a stale reload before checking whether the node still exists
  if (lastLibraryNodeId) {
    const node = libraryGraphViewModel.getState().nodes.find((n) => n.id === lastLibraryNodeId);
    if (node) libraryNodePopup.open(node);
  }
});

// showLibraryTab() already covers "is the library data fresh" (staleness
// flag), so this only needs its own fallback load if the node still isn't
// there yet — e.g. clicking within the first moment after page load, before
// the eager load() above has resolved.
async function viewInLibrary(nodeId) {
  showLibraryTab();
  let node = libraryGraphViewModel.getState().nodes.find((n) => n.id === nodeId);
  if (!node) {
    await libraryGraphViewModel.load();
    node = libraryGraphViewModel.getState().nodes.find((n) => n.id === nodeId);
  }
  if (!node) return; // shouldn't happen once status is 'ready', but don't crash if it does
  libraryNodePopup.open(node);
  libraryGraphView.centerOnNode(nodeId);
}
