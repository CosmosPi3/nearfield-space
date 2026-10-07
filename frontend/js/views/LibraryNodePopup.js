import { escapeHtml } from './domUtils.js';
import { videoSlotHtml, statsChipsHtml, externalLinkHtml, searchIconsHtml, neighborsSectionHtml, syncFavouriteButtons, syncFavouriteIndicators } from './trackDetailHelpers.js';
import { endpointNode } from './graphRenderHelpers.js';
import { createMiniPlayer } from './miniPlayer.js';
import * as api from '../services/api.js';

// A docked right-side panel, same positioning idea as #node-detail-panel, but
// deliberately not that component — NodeDetailPanel is coupled to workspace
// concepts (pin/unpin, Discover, delete) that don't apply to a track the
// user is just browsing in the full-library graph; those are replaced here
// by a single "Add to workspace" action. Everything else (video, stats,
// external link, search icons) mirrors NodeDetailPanel via the same shared
// trackDetailHelpers — but not the workspace-only "Found via"/"Discovered
// via this track" relations, which are deliberately omitted here since
// they're about the workspace exploration session, not the track itself.
//
// Video embed shows immediately (videoId is already known from the graph
// node); the stats chips need a fetch — every library track is already
// fully analyzed (extraction_status='ok'), so /features returns the cached
// record instantly.
export function createLibraryNodePopup({ panelEl, libraryGraphViewModel, favouritesViewModel, onAddToWorkspace, onSelectionChange, onVideoEnded, onSkipPrevious, onSkipNext, getSkipState }) {
  let currentNode = null;
  let detail = null;
  let loadError = null;
  let miniPlayer = null;
  // Consumed by the very next render()'s miniPlayer construction only — see
  // NodeDetailPanel.js's identical pattern — then cleared, so a later
  // re-render (e.g. once loadDetail() resolves) never replays it.
  let pendingAutoplay = false;

  // Keeps the heart in sync if the same track is (un)favourited from the
  // Discovery popup while this panel is open.
  favouritesViewModel.subscribe(() => {
    if (!currentNode) return;
    syncFavouriteButtons(panelEl, favouritesViewModel.isFavourited(currentNode.id));
    syncFavouriteIndicators(panelEl, (id) => favouritesViewModel.isFavourited(id));
  });

  function open(node, { autoplay = false } = {}) {
    currentNode = node;
    detail = null;
    loadError = null;
    pendingAutoplay = autoplay;
    // Every open() starts at the mobile peek preview, never mid-expanded —
    // even if a different node was left expanded, e.g. via a "Similar
    // tracks" click while browsing full details. Harmless on desktop,
    // where .expanded has no CSS effect.
    panelEl.classList.remove('expanded');
    panelEl.classList.remove('hidden');
    // Before the render below, not after — render()'s getSkipState() call
    // reads the walk's current position, and onSelectionChange is what
    // resets that position for a manual (non-autoplay) open. Rendering
    // first would compute the skip buttons' disabled state one step stale
    // (empty on first load, or still pointing at the previous node after).
    onSelectionChange?.(node.id, { autoplay });
    render();
    loadDetail(node.id);
  }

  async function loadDetail(id) {
    try {
      const result = await api.getFeatures(id);
      if (currentNode?.id !== id) return; // popup moved on to a different node while this was in flight
      detail = result;
      render();
    } catch (err) {
      if (currentNode?.id !== id) return;
      loadError = err.message;
      render();
    }
  }

  function close() {
    currentNode = null;
    detail = null;
    loadError = null;
    miniPlayer?.destroy();
    miniPlayer = null;
    panelEl.classList.add('hidden');
    onSelectionChange?.(null);
  }

  function render() {
    if (!currentNode) return;
    const node = currentNode;
    const title = node.track || node.name || 'Untitled';
    const viewCount = detail?.viewCount ?? node.viewCount;

    const linksHtml = detail ? externalLinkHtml(detail) : '';
    // render() re-runs a second time once the async getFeatures() fetch
    // resolves, with the same videoId — detach/reattach (not
    // destroy/recreate) keeps that fetch from interrupting playback. See
    // NodeDetailPanel.js for the same pattern.
    const videoId = node.videoId;
    if (miniPlayer && miniPlayer.videoId !== videoId) {
      miniPlayer.destroy();
      miniPlayer = null;
    }
    miniPlayer?.element.remove();
    const videoHtml = videoSlotHtml(videoId);
    const statsHtml = detail
      ? statsChipsHtml(detail)
      : loadError
        ? `<p class="hint">Failed to load details: ${escapeHtml(loadError)}</p>`
        : `<p class="hint">Loading details…</p>`;
    const searchHtml = searchIconsHtml({ artist: node.artist, title });

    // This node's edges in the current library graph, not the workspace's
    // recorded discovery edges — force-graph resolves link.source/target
    // from plain id strings to real node object refs in place once the
    // simulation has run, hence the endpointNode fallback lookup.
    const { nodes: libNodes, links: libLinks } = libraryGraphViewModel.getState();
    const nodeLookup = new Map(libNodes.map((n) => [n.id, n]));
    const neighbors = libLinks
      .map((l) => {
        const a = endpointNode(l.source, nodeLookup);
        const b = endpointNode(l.target, nodeLookup);
        if (!a || !b) return null;
        if (a.id === node.id) return { node: b, cosineScore: l.cosineScore };
        if (b.id === node.id) return { node: a, cosineScore: l.cosineScore };
        return null;
      })
      .filter(Boolean)
      .sort((x, y) => y.cosineScore - x.cosineScore);
    const neighborsHtml = neighborsSectionHtml(neighbors, (id) => favouritesViewModel.isFavourited(id));
    const favourited = favouritesViewModel.isFavourited(node.id);

    panelEl.innerHTML = `
      <div class="popup-header-row">
        <div class="popup-header-text">
          <div class="popup-title">${escapeHtml(title)}</div>
          <div class="popup-artist">${escapeHtml(node.artist || '')}</div>
        </div>
        <div class="popup-viewcount">
          <span class="popup-viewcount-value">${viewCount != null ? viewCount.toLocaleString() : '–'}</span>
          <span class="popup-viewcount-label">views</span>
        </div>
        <button class="popup-header-favourite ${favourited ? 'popup-header-favourite-active' : ''}" title="${favourited ? 'Unfavourite' : 'Favourite'}">
          <i class="fa-${favourited ? 'solid' : 'regular'} fa-heart" aria-hidden="true"></i>
        </button>
        <button class="popup-close" title="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      ${(linksHtml || node.discoveredByDisplayName) ? `
        <div class="popup-link-row">
          ${linksHtml}
          ${node.discoveredByDisplayName ? `<span class="popup-discovered-by">Discovered by <span class="popup-discovered-by-name">${escapeHtml(node.discoveredByDisplayName)}</span></span>` : ''}
        </div>
      ` : ''}
      <div class="popup-media-row">
        ${videoHtml}
        ${statsHtml}
      </div>
      <button class="popup-expand-toggle"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>View full details</button>
      <div class="popup-actions">
        <button class="popup-favourite ${favourited ? 'popup-favourite-active' : ''}" title="${favourited ? 'Unfavourite' : 'Favourite'}">
          <i class="fa-${favourited ? 'solid' : 'regular'} fa-heart" aria-hidden="true"></i>
        </button>
        <button class="popup-add-to-workspace"><i class="popup-btn-icon fa-solid fa-plus" aria-hidden="true"></i>Add to workspace</button>
      </div>
      ${neighborsHtml}
      ${searchHtml ? `<div class="popup-section"><div class="popup-section-title">Search</div><div class="popup-icon-row"><div class="popup-search-icons">${searchHtml}</div></div></div>` : ''}
    `;

    const videoSlotEl = panelEl.querySelector('.popup-video-slot');
    if (videoSlotEl) {
      if (!miniPlayer) {
        miniPlayer = createMiniPlayer(videoId, {
          autoplay: pendingAutoplay,
          onEnded: () => onVideoEnded?.(node.id),
          onSkipPrevious: () => onSkipPrevious?.(),
          onSkipNext: () => onSkipNext?.(),
        });
        pendingAutoplay = false;
      }
      miniPlayer.setSkipState(getSkipState?.());
      videoSlotEl.replaceWith(miniPlayer.element);
    }

    panelEl.querySelector('.popup-close').addEventListener('click', close);
    // No-op on desktop — .expanded only has a CSS effect within the mobile
    // media query. Button itself is hidden there via .expanded's own CSS,
    // so there's no "collapse back to peek" path, only close().
    panelEl.querySelector('.popup-expand-toggle').addEventListener('click', () => panelEl.classList.toggle('expanded'));
    panelEl.querySelector('.popup-add-to-workspace').addEventListener('click', () => {
      onAddToWorkspace?.(node);
    });
    const toggleFavourite = () => favouritesViewModel.toggleFavourite(node.id);
    panelEl.querySelector('.popup-favourite').addEventListener('click', toggleFavourite);
    panelEl.querySelector('.popup-header-favourite').addEventListener('click', toggleFavourite);
    panelEl.querySelectorAll('.popup-relation-item').forEach((el) => {
      el.addEventListener('click', () => {
        const relNode = libraryGraphViewModel.getState().nodes.find((n) => n.id === el.dataset.nodeId);
        if (relNode) open(relNode);
      });
    });
  }

  return { open, close };
}
