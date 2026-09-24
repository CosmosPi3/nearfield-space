import { escapeHtml } from './domUtils.js';
import { videoSlotHtml, statsChipsHtml, externalLinkHtml, searchIconsHtml, relationsHtml as buildRelationsHtml } from './trackDetailHelpers.js';
import { createMiniPlayer } from './miniPlayer.js';

const STATUS_MESSAGE = {
  pending: 'Loading features…',
  unavailable: 'No audio available for this track.',
};

// Delete sits on the same row as the search icons, right-justified via
// justify-content on .popup-icon-row — it's rendered even when there's no
// artist/title to search for (a pending/error node still needs to be
// removable), unlike the search icons themselves which need a real query.
function buildActionsRowHtml(node) {
  const iconsHtml = searchIconsHtml(node);
  return `
    <div class="popup-section">
      ${iconsHtml ? '<div class="popup-section-title">Search</div>' : ''}
      <div class="popup-icon-row">
        <div class="popup-search-icons">${iconsHtml}</div>
        <button class="popup-delete" title="Remove this track from the graph — cached features/distances are kept, so re-adding it is instant">
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
}

// A docked right-side panel rather than a floating tooltip — avoids needing
// to track the node's on-screen position as the graph pans/zooms/simulates.
export function createNodeDetailPanel({ panelEl, graphViewModel, branchingInputEl, depthInputEl, onSelectionChange, onItemHover, onViewInLibrary }) {
  let currentNodeId = null;
  let miniPlayer = null;

  graphViewModel.subscribe(() => {
    if (currentNodeId) renderPanel(currentNodeId);
  });

  function open(node) {
    currentNodeId = node.id;
    panelEl.classList.remove('hidden');
    renderPanel(node.id);
    onSelectionChange?.(node.id);
  }

  function close() {
    currentNodeId = null;
    miniPlayer?.destroy();
    miniPlayer = null;
    panelEl.classList.add('hidden');
    onSelectionChange?.(null);
  }

  function renderPanel(nodeId) {
    const node = graphViewModel.graphState.nodes.get(nodeId);
    if (!node) {
      close();
      return;
    }

    const { discovering } = graphViewModel.getState();
    const isManual = node.id.startsWith('manual:'); // no cosine.club id -> Discover uses our own cache instead

    let statsHtml;
    let relationsHtml = '';
    let viewCountHtml = '';
    if (node.status === 'ready') {
      viewCountHtml = `
        <div class="popup-viewcount">
          <span class="popup-viewcount-value">${node.viewCount != null ? node.viewCount.toLocaleString() : '–'}</span>
          <span class="popup-viewcount-label">views</span>
        </div>`;

      statsHtml = statsChipsHtml(node);
      relationsHtml = buildRelationsHtml(graphViewModel.graphState, node.id);
    } else {
      const msg = STATUS_MESSAGE[node.status] || `Extraction failed: ${escapeHtml(node.error || 'unknown error')}`;
      statsHtml = `<p class="hint">${msg}</p>`;
    }

    const linksHtml = externalLinkHtml(node);
    const actionsRowHtml = buildActionsRowHtml(node);

    const videoId = node.status === 'ready' ? node.videoId : null;
    // renderPanel() re-runs on *any* graphViewModel change while this node's
    // panel is open (e.g. Discover polling elsewhere), not just when this
    // node's own data changes — so the live mini player must survive an
    // innerHTML wipe when the videoId hasn't actually changed. Detach it now
    // (synchronously, no await in between) and it gets reattached right
    // after the innerHTML assignment below; only destroy/recreate it when
    // the track itself changed.
    if (miniPlayer && miniPlayer.videoId !== videoId) {
      miniPlayer.destroy();
      miniPlayer = null;
    }
    miniPlayer?.element.remove();
    const videoHtml = videoSlotHtml(videoId);
    // Only once extraction is done — the library graph only contains
    // successfully-analyzed ("ok") tracks, so there's nothing to view yet
    // for a pending/failed one.
    const viewInLibraryHtml = node.status === 'ready' ? '<button class="popup-view-in-library"><i class="popup-btn-icon fa-solid fa-book" aria-hidden="true"></i>View in library</button>' : '';

    panelEl.innerHTML = `
      <button class="popup-close" title="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="popup-header-row">
        <div class="popup-header-text">
          <div class="popup-title">${escapeHtml(node.title || node.label)}</div>
          <div class="popup-artist">${escapeHtml(node.artist || '')}</div>
          ${linksHtml}
        </div>
        ${viewCountHtml}
      </div>
      ${videoHtml}
      ${statsHtml}
      <button class="popup-discover" ${node.status !== 'ready' || discovering ? 'disabled' : ''}
        ${isManual ? 'title="Not in cosine.club\'s catalog — searches only tracks already analyzed in this app, not cosine.club\'s full catalog"' : ''}>
        <i class="popup-btn-icon fa-solid fa-compass" aria-hidden="true"></i>${discovering ? 'Discovering…' : 'Discover'}
      </button>
      <div class="popup-actions">
        <button class="popup-pin ${node.kind === 'seed' ? 'popup-pin-active' : ''}">
          <i class="popup-btn-icon fa-solid ${node.kind === 'seed' ? 'fa-thumbtack-slash' : 'fa-thumbtack'}" aria-hidden="true"></i>${node.kind === 'seed' ? 'Unpin' : 'Pin'}
        </button>
        ${viewInLibraryHtml}
      </div>
      ${relationsHtml}
      ${actionsRowHtml}
    `;

    const videoSlotEl = panelEl.querySelector('.popup-video-slot');
    if (videoSlotEl) {
      if (!miniPlayer) miniPlayer = createMiniPlayer(videoId);
      videoSlotEl.replaceWith(miniPlayer.element);
    }

    panelEl.querySelector('.popup-close').addEventListener('click', close);
    panelEl.querySelector('.popup-view-in-library')?.addEventListener('click', () => onViewInLibrary?.(nodeId));
    panelEl.querySelector('.popup-pin').addEventListener('click', () => {
      if (node.kind === 'seed') {
        graphViewModel.unpinTrack(nodeId);
      } else {
        graphViewModel.pinTrack({ id: nodeId });
      }
    });
    panelEl.querySelector('.popup-discover').addEventListener('click', () => {
      const branching = Math.max(2, parseInt(branchingInputEl.value, 10) || 5);
      const depth = Math.max(1, parseInt(depthInputEl.value, 10) || 1);
      graphViewModel.discoverFrom(nodeId, { depth, branching });
    });
    panelEl.querySelector('.popup-delete').addEventListener('click', () => {
      graphViewModel.removeNode(nodeId);
      close();
    });
    panelEl.querySelectorAll('.popup-relation-item, .popup-found-via-card').forEach((el) => {
      el.addEventListener('click', () => open({ id: el.dataset.nodeId }));
      el.addEventListener('mouseenter', () => onItemHover?.(el.dataset.nodeId));
      el.addEventListener('mouseleave', () => onItemHover?.(null));
    });
  }

  return { open, close };
}
