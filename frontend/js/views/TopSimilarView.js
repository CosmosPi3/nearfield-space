import { escapeHtml } from './domUtils.js';
import { toDisplayScore } from './scoreDisplay.js';
import { thumbnailImgHtml } from './thumbnail.js';
import { favouriteHeartHtml } from './trackDetailHelpers.js';

export function createTopSimilarView({ listEl, graphViewModel, favouritesViewModel, onItemClick, onItemHover }) {
  let selectedNodeId = null;
  graphViewModel.subscribe(render);
  favouritesViewModel.subscribe(render);
  render();

  function render() {
    const { topSimilar } = graphViewModel.getState();
    listEl.innerHTML = '';
    for (const { node, avgScore } of topSimilar) {
      const li = document.createElement('li');
      li.classList.toggle('top-similar-item-active', node.id === selectedNodeId);
      const views = node.viewCount != null ? `${node.viewCount.toLocaleString()} views` : 'views unknown';
      li.innerHTML = `
        ${thumbnailImgHtml(node.videoId)}
        <div class="top-similar-text">
          <div class="top-similar-title">${escapeHtml(node.title || node.label)}${favouriteHeartHtml(favouritesViewModel.isFavourited(node.id))}</div>
          <div class="top-similar-meta">${escapeHtml(node.artist || '')} · <span class="top-similar-score">${toDisplayScore(avgScore).toFixed(2)}</span></div>
          <div class="top-similar-views">${views}</div>
        </div>
      `;
      li.addEventListener('click', () => onItemClick?.(node));
      li.addEventListener('mouseenter', () => onItemHover?.(node.id));
      li.addEventListener('mouseleave', () => onItemHover?.(null));
      listEl.appendChild(li);
    }
  }

  function setSelectedNodeId(nodeId) {
    selectedNodeId = nodeId;
    render();
  }

  return { setSelectedNodeId };
}
