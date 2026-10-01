import { restoreSession, logout, updateDisplayName } from './services/auth.js';
import { showAuthGate } from './views/authGate.js';
import { createSearchViewModel } from './viewmodels/SearchViewModel.js';
import { createGraphViewModel } from './viewmodels/GraphViewModel.js';
import { createLibraryGraphViewModel } from './viewmodels/LibraryGraphViewModel.js';
import { createFavouritesViewModel } from './viewmodels/FavouritesViewModel.js';
import { createLibrarySearchViewModel } from './viewmodels/LibrarySearchViewModel.js';
import { createSearchView } from './views/SearchView.js';
import { createLibrarySearchView } from './views/LibrarySearchView.js';
import { createSeedListView } from './views/SeedListView.js';
import { createGraphView } from './views/GraphView.js';
import { createLibraryGraphView } from './views/LibraryGraphView.js';
import { createLibraryNodePopup } from './views/LibraryNodePopup.js';
import { createFavouritesListView } from './views/FavouritesListView.js';
import { createNodeDetailPanel } from './views/NodeDetailPanel.js';
import { setupDiscoveryToasts } from './views/discoveryToasts.js';
import { createTopSimilarView } from './views/TopSimilarView.js';
import { setupInfoTooltips } from './views/infoTooltip.js';
import { fromNormalized, toNormalized } from './views/normalize.js';
import { showToast } from './views/toast.js';
import { endpointNode } from './views/graphRenderHelpers.js';

// Sign-in is required to use the site at all (the backend rejects every
// /api/* call without a valid session) — block on it before touching any
// DOM/viewmodel/API code below.
let currentUser = await restoreSession();
if (!currentUser) {
  currentUser = await showAuthGate({
    overlayEl: document.getElementById('auth-gate-overlay'),
    buttonContainerEl: document.getElementById('auth-gate-button'),
    statusEl: document.getElementById('auth-gate-status'),
  });
}

const accountChipEl = document.getElementById('account-chip');
const accountAvatarEl = document.getElementById('account-avatar');
const accountNameEl = document.getElementById('account-name');
accountNameEl.textContent = currentUser.displayName;
if (currentUser.avatarUrl) accountAvatarEl.src = currentUser.avatarUrl;
accountChipEl.classList.remove('hidden');

// Confirmation guard against an accidental misclick — logging out otherwise
// has no undo (back to the sign-in gate, same as a fresh visit).
const logoutConfirmOverlayEl = document.getElementById('logout-confirm-overlay');
document.getElementById('account-logout-button').addEventListener('click', () => {
  logoutConfirmOverlayEl.classList.remove('hidden');
});
document.getElementById('logout-confirm-cancel').addEventListener('click', () => {
  logoutConfirmOverlayEl.classList.add('hidden');
});
logoutConfirmOverlayEl.addEventListener('click', (e) => {
  if (e.target === logoutConfirmOverlayEl) logoutConfirmOverlayEl.classList.add('hidden');
});
document.getElementById('logout-confirm-confirm').addEventListener('click', async () => {
  await logout();
  window.location.reload();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') logoutConfirmOverlayEl.classList.add('hidden');
});

// --- Edit display name popover ---------------------------------------------
const editNamePopoverEl = document.getElementById('edit-display-name-popover');
const editNameInputEl = document.getElementById('edit-display-name-input');
const editNameErrorEl = document.getElementById('edit-display-name-error');

function closeEditNamePopover() {
  editNamePopoverEl.classList.add('hidden');
  editNameErrorEl.classList.add('hidden');
}

document.getElementById('account-edit-name-button').addEventListener('click', () => {
  editNameInputEl.value = currentUser.displayName;
  editNameErrorEl.classList.add('hidden');
  editNamePopoverEl.classList.remove('hidden');
  editNameInputEl.focus();
});
document.getElementById('edit-display-name-cancel').addEventListener('click', closeEditNamePopover);
document.addEventListener('click', (e) => {
  // closest(), not a plain id check — a tap often lands on the button's
  // icon child (no id of its own), not the button element itself, which
  // was closing the popover on the very same click that opened it.
  if (!editNamePopoverEl.classList.contains('hidden')
    && !editNamePopoverEl.contains(e.target)
    && !e.target.closest('#account-edit-name-button')) {
    closeEditNamePopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeEditNamePopover();
});

async function saveDisplayName() {
  try {
    const updated = await updateDisplayName(editNameInputEl.value);
    currentUser = { ...currentUser, displayName: updated.displayName };
    accountNameEl.textContent = currentUser.displayName;
    closeEditNamePopover();
    showToast('Display name updated', { variant: 'success' });
    // Refetches /graph/library so every "Discovered by <name>" credit
    // attributed to this account picks up the new name immediately,
    // instead of waiting for the next tab switch's staleness check.
    libraryGraphViewModel.load();
  } catch (err) {
    editNameErrorEl.textContent = err.message;
    editNameErrorEl.classList.remove('hidden');
  }
}
document.getElementById('edit-display-name-save').addEventListener('click', saveDisplayName);
editNameInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveDisplayName();
});

// Shifts the chip out from behind the node popup (desktop only — see
// style.css) whenever either the Discovery or Library node panel is open,
// since both are fixed to the same bottom-right-adjacent corner.
let workspacePopupOpen = false;
let libraryPopupOpen = false;
function updateAccountChipOffset() {
  accountChipEl.classList.toggle('popup-open', workspacePopupOpen || libraryPopupOpen);
}

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

const favouritesViewModel = createFavouritesViewModel();
await favouritesViewModel.hydrate();

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
  // Keeps the toast entirely at this composition layer — GraphViewModel
  // itself stays toast-agnostic, same separation discoveryToasts.js keeps
  // for the discovery flow.
  onDiscogsFallback: async (query) => {
    const toast = showToast(`Searching Discogs & YouTube for "${query}"…`, { duration: null, variant: 'discovery' });
    try {
      const track = await graphViewModel.addTrackFromDiscogsFallback(query);
      toast.dismiss();
      nodeDetailPanel.open(track);
    } catch (err) {
      toast.dismiss();
      showToast(err.message || `No match found for "${query}"`, { variant: 'error' });
    }
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

// --- Autoplay: walk the graph, hopping to the closest still-unplayed track
// each time the current video ends. `playedNodeIds` tracks the current
// walk's visited set (never-repeat within one walk) and is shared across
// both the Discovery and Library popups below — reset whenever the toggle
// switches on, or whenever a node is opened manually rather than by
// autoplay itself, since a manual click starts a fresh walk from there.
const AUTOPLAY_STORAGE_KEY = 'nearfieldspace:autoplay';
const autoplayToggleButtonEl = document.getElementById('autoplay-toggle-button');
let autoplayEnabled = localStorage.getItem(AUTOPLAY_STORAGE_KEY) === 'true';
let playedNodeIds = new Set();

function updateAutoplayButtonUI() {
  autoplayToggleButtonEl.classList.toggle('active', autoplayEnabled);
  autoplayToggleButtonEl.setAttribute('aria-pressed', String(autoplayEnabled));
}
updateAutoplayButtonUI();

autoplayToggleButtonEl.addEventListener('click', () => {
  autoplayEnabled = !autoplayEnabled;
  localStorage.setItem(AUTOPLAY_STORAGE_KEY, String(autoplayEnabled));
  if (autoplayEnabled) playedNodeIds = new Set();
  updateAutoplayButtonUI();
  showToast(autoplayEnabled ? 'Autoplay enabled' : 'Autoplay disabled', { variant: 'autoplay' });
});

createSeedListView({
  listEl: document.getElementById('seed-tracks-list'),
  graphViewModel,
  favouritesViewModel,
  onItemClick: (node) => nodeDetailPanel.open(node),
  onItemHover: (nodeId) => graphView.setHoveredNodeId(nodeId),
});

const nodeDetailPanel = createNodeDetailPanel({
  panelEl: document.getElementById('node-detail-panel'),
  graphViewModel,
  favouritesViewModel,
  branchingInputEl: document.getElementById('branching-input'),
  depthInputEl: document.getElementById('depth-input'),
  onSelectionChange: (nodeId, { autoplay = false } = {}) => {
    graphView.setSelectedNodeId(nodeId);
    if (nodeId != null) lastWorkspaceNodeId = nodeId;
    // A manual open (not one autoplay drove itself) restarts the walk from
    // here — otherwise a track played earlier in a previous hop stays
    // excluded forever, even though it may be this node's actual closest
    // neighbor now that we've navigated back to it.
    if (nodeId != null && !autoplay) playedNodeIds = new Set();
    workspacePopupOpen = nodeId != null;
    updateAccountChipOffset();
  },
  onItemHover: (nodeId) => graphView.setHoveredNodeId(nodeId),
  onViewInLibrary: (nodeId) => viewInLibrary(nodeId),
  onVideoEnded: (nodeId) => {
    if (!autoplayEnabled) return;
    playedNodeIds.add(nodeId);
    const next = graphViewModel.graphState.neighborsOf(nodeId)
      .map(({ otherId, similarity }) => ({ id: otherId, similarity, node: graphViewModel.graphState.nodes.get(otherId) }))
      .filter(({ id, node }) => node?.status === 'ready' && !playedNodeIds.has(id))
      .sort((a, b) => (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity))[0];
    if (!next) {
      autoplayEnabled = false;
      localStorage.setItem(AUTOPLAY_STORAGE_KEY, 'false');
      updateAutoplayButtonUI();
      showToast('Autoplay disabled — no more tracks to play', { variant: 'autoplay' });
      return;
    }
    nodeDetailPanel.open(next.node, { autoplay: true });
    graphView.centerOnNode(next.id);
  },
});

setupDiscoveryToasts({ graphViewModel });

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
  favouritesViewModel,
  onItemClick: (node) => nodeDetailPanel.open(node),
  onItemHover: (nodeId) => graphView.setHoveredNodeId(nodeId),
});

document.getElementById('reset-graph-button').addEventListener('click', () => {
  graphViewModel.resetGraph();
});

// Pinned Tracks / Most Similar section collapse — one generic listener for
// both .sidebar-card-toggle buttons, since they're otherwise identical.
document.querySelectorAll('.sidebar-card-toggle').forEach((toggleEl) => {
  toggleEl.addEventListener('click', () => {
    const collapsed = toggleEl.closest('.sidebar-card').classList.toggle('collapsed');
    toggleEl.setAttribute('aria-expanded', String(!collapsed));
    // Collapsing/expanding changes #sidebar's own height (an "auto" grid
    // row on mobile), which changes how much room #graph-container/
    // #library-container's "1fr" row actually gets — same reflow-not-a-
    // window-resize gap as the top-bar hamburger toggle below, so both
    // graphs' canvases need an explicit resize() to catch up.
    graphView.resize();
    libraryGraphView.resize();
  });
});

// Mobile-only hamburger toggle (the button itself is hidden via CSS on
// desktop, so this listener is just unreachable there, not disabled) —
// collapses #search-panel/#reset-graph-button, per style.css's
// `#top-bar.collapsed` rule, freeing the graph's vertical space on a
// small screen while keeping the title/tabs/help always visible.
const topbarToggleButtonEl = document.getElementById('topbar-toggle-button');
topbarToggleButtonEl.addEventListener('click', () => {
  const collapsed = document.getElementById('top-bar').classList.toggle('collapsed');
  topbarToggleButtonEl.setAttribute('aria-expanded', String(!collapsed));
  // Collapsing/expanding grows or shrinks #graph-container/#library-
  // container's actual clientHeight (the "1fr" grid row gets more/less
  // room), but that's a layout reflow, not a window resize — force-graph's
  // <canvas> only ever matches its container's size when told to via
  // resize(), which both views otherwise only call on an actual `resize`
  // window event. Without this, the canvas stays the old (smaller) size
  // and the container's now-larger background shows through underneath it.
  graphView.resize();
  libraryGraphView.resize();
});

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
  favouritesViewModel,
  onAddToWorkspace: async (node) => {
    await graphViewModel.addTrack(node); // no-op if already present; otherwise persists + loads features
    showWorkspaceTab(); // closes libraryNodePopup
    nodeDetailPanel.open({ id: node.id });
    graphView.centerOnNode(node.id);
  },
  onSelectionChange: (nodeId, { autoplay = false } = {}) => {
    libraryGraphView.setSelectedNodeId(nodeId);
    if (nodeId != null) lastLibraryNodeId = nodeId;
    if (nodeId != null && !autoplay) playedNodeIds = new Set();
    libraryPopupOpen = nodeId != null;
    updateAccountChipOffset();
  },
  onVideoEnded: (nodeId) => {
    if (!autoplayEnabled) return;
    playedNodeIds.add(nodeId);
    // Library has no separate "graph state" model — its edges are just the
    // currently-loaded {nodes, links} in the view model (only pairs above
    // the Min similarity threshold are even present), so "closest" here
    // means closest among those already-drawn edges, same idea as the
    // workspace but scoped to whatever's actually rendered.
    const { nodes: libNodes, links: libLinks } = libraryGraphViewModel.getState();
    const nodeLookup = new Map(libNodes.map((n) => [n.id, n]));
    const next = libLinks
      .map((l) => {
        const a = endpointNode(l.source, nodeLookup);
        const b = endpointNode(l.target, nodeLookup);
        if (!a || !b) return null;
        if (a.id === nodeId) return { id: b.id, node: b, similarity: l.cosineScore };
        if (b.id === nodeId) return { id: a.id, node: a, similarity: l.cosineScore };
        return null;
      })
      .filter(Boolean)
      .filter(({ id }) => !playedNodeIds.has(id))
      .sort((x, y) => (y.similarity ?? -Infinity) - (x.similarity ?? -Infinity))[0];
    if (!next) {
      autoplayEnabled = false;
      localStorage.setItem(AUTOPLAY_STORAGE_KEY, 'false');
      updateAutoplayButtonUI();
      showToast('Autoplay disabled — no more tracks to play', { variant: 'autoplay' });
      return;
    }
    libraryNodePopup.open(next.node, { autoplay: true });
    libraryGraphView.centerOnNode(next.id);
  },
});

createFavouritesListView({
  listEl: document.getElementById('favourites-list'),
  sortButtonsEl: document.getElementById('favourites-sort-row'),
  favouritesViewModel,
  libraryGraphViewModel,
  onItemClick: (node) => {
    favouritesModalOverlayEl.classList.add('hidden');
    viewInLibrary(node.id);
  },
});

const favouritesModalOverlayEl = document.getElementById('favourites-modal-overlay');
document.getElementById('favourites-list-button').addEventListener('click', () => {
  favouritesModalOverlayEl.classList.remove('hidden');
});
document.getElementById('favourites-modal-close').addEventListener('click', () => {
  favouritesModalOverlayEl.classList.add('hidden');
});
favouritesModalOverlayEl.addEventListener('click', (e) => {
  if (e.target === favouritesModalOverlayEl) favouritesModalOverlayEl.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') favouritesModalOverlayEl.classList.add('hidden');
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

  graphView.resize(); // container may have resized while it was display:none (mirrors showLibraryTab()'s own resize() call below)
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
