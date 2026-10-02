import { createStore } from './store.js';
import * as api from '../services/api.js';
import { computeViewsBounds } from './libraryFilters.js';

const DEFAULT_THRESHOLD = 0.75;
// Below this, the edge count balloons toward the full O(N^2) pair set —
// clamped here too (not just via the slider's min), since setThreshold can
// be called from more than one caller.
const MIN_THRESHOLD = 0.5;

// Mirrors backend/src/config.js's BPM_RANGE_MIN/MAX — every persisted
// tempo_bpm value is already folded into this fixed range server-side
// (utils/bpmRange.js), so the frontend can trust it rather than deriving
// bounds from whatever's currently loaded.
const DEFAULT_BPM_RANGE = [90, 180];
const DEFAULT_VIBE_RANGE = [0, 1];

export function createLibraryGraphViewModel() {
  const store = createStore({
    nodes: [],
    links: [],
    allLinks: [],
    filters: {
      bpm: DEFAULT_BPM_RANGE,
      views: [0, 0],
      vibe: DEFAULT_VIBE_RANGE,
    },
    viewsBounds: { min: 0, max: 0 },
    threshold: DEFAULT_THRESHOLD,
    loading: false,
    loaded: false,
    error: null,
  });

  // Guards against overlapping load() calls — e.g. showLibraryTab()'s own
  // lazy first-load racing a cross-tab "View in library" navigation's
  // fallback load. Every load() fetches the same thing (the full edge set
  // down to MIN_THRESHOLD), so there's no need to key the dedup by
  // threshold. Each load() replaces graphData() with brand-new node
  // objects, which force-graph treats as a fresh dataset and repositions —
  // two concurrent calls landing back-to-back silently undoes whatever the
  // first one's caller just did (e.g. a camera-center lands on a node that
  // then jumps to a new position when the second, redundant load's render
  // fires). Sharing the in-flight promise means both callers await the same
  // single graphData() update.
  let inFlight = null;

  // Node fields deliberately mirror the raw track shape (name/artist/track),
  // not just a display label — graphViewModel.addTrack() reads track.artist/
  // track.track/track.name directly (see models/Track.js), so keeping those
  // around lets the "Add to workspace" bridge pass a node straight through
  // with no translation layer.
  function load() {
    if (inFlight) return inFlight;

    store.setState({ loading: true, error: null });
    inFlight = (async () => {
      try {
        // Always fetch at MIN_THRESHOLD, not the UI's current threshold —
        // the Library graph UI never requests below MIN_THRESHOLD anyway
        // (see its definition above), so this one fetch covers every
        // threshold the slider can ever be set to. setThreshold() then
        // filters this in-memory, with no further network calls.
        const { tracks, edges } = await api.getLibraryGraph(MIN_THRESHOLD);
        const nodes = tracks.map((t) => ({
          id: t.id,
          name: t.name,
          artist: t.artist,
          track: t.track,
          label: `${t.artist || 'Unknown'} - ${t.track || t.name || 'Untitled'}`,
          videoId: t.videoId ?? null,
          viewCount: t.viewCount ?? null,
          tempoBpm: t.tempoBpm ?? null,
          energyValence: t.energyValence ?? null,
          discoveredByDisplayName: t.discoveredByDisplayName ?? null,
        }));

        // viewsBounds always comes from this fresh, full node set.
        const viewsBounds = computeViewsBounds(nodes);
        const prevState = store.getState();
        // On the very first successful load there's no user selection yet,
        // so the Views filter starts wide open; on a later reload (e.g. a
        // background library refresh) an existing selection is preserved,
        // just re-clamped in case the underlying data's range shifted.
        const views = prevState.loaded ? clampRange(prevState.filters.views, viewsBounds) : [viewsBounds.min, viewsBounds.max];
        const filters = { ...prevState.filters, views };

        const allLinks = edges;
        const links = allLinks.filter((e) => e.cosineScore >= prevState.threshold);

        store.setState({ nodes, allLinks, links, viewsBounds, filters, loading: false, loaded: true });
      } catch (err) {
        store.setState({ loading: false, error: err.message });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  // Pure, synchronous — filters the already-fetched allLinks down to the new
  // threshold with no network call. Still changes which edges are present in
  // `links` (real topology), which is what sets it apart from the BPM/views/
  // vibe setters below: those only ever touch `filters` and never remove
  // anything from `nodes`/`links` (see their own comment).
  function setThreshold(value) {
    const threshold = Math.min(1, Math.max(MIN_THRESHOLD, value));
    store.setState((s) => ({ threshold, links: s.allLinks.filter((e) => e.cosineScore >= threshold) }));
  }

  // No node/link removal — unlike setThreshold(), these three just update
  // `filters` in place; nodes/links are never filtered out of the store's
  // state, only marked as matching/non-matching by the view at draw time
  // (see LibraryGraphView.js), so a connection between an in-range and an
  // out-of-range track stays visible either way.
  function setBpmRange(min, max) {
    store.setState((s) => ({ filters: { ...s.filters, bpm: [min, max] } }));
  }

  function setViewsRange(min, max) {
    store.setState((s) => ({ filters: { ...s.filters, views: [min, max] } }));
  }

  function setVibeRange(min, max) {
    store.setState((s) => ({ filters: { ...s.filters, vibe: [min, max] } }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    setThreshold,
    setBpmRange,
    setViewsRange,
    setVibeRange,
  };
}

function clampRange([lo, hi], bounds) {
  const clampedLo = Math.min(Math.max(lo, bounds.min), bounds.max);
  const clampedHi = Math.min(Math.max(hi, bounds.min), bounds.max);
  return [Math.min(clampedLo, clampedHi), Math.max(clampedLo, clampedHi)];
}
