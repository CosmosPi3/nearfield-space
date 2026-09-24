import { escapeHtml } from './domUtils.js';
import { toDisplayScore } from './scoreDisplay.js';
import { thumbnailImgHtml } from './thumbnail.js';

export function createTopSimilarView({ listEl, graphViewModel, onItemClick, onItemHover }) {
  graphViewModel.subscribe(render);
  render();

  function render() {
    const { topSimilar } = graphViewModel.getState();
    listEl.innerHTML = '';
    for (const { node, avgScore } of topSimilar) {
      const li = document.createElement('li');
      const views = node.viewCount != null ? `${node.viewCount.toLocaleString()} views` : 'views unknown';
      li.innerHTML = `
        ${thumbnailImgHtml(node.videoId)}
        <div class="top-similar-text">
          <div class="top-similar-title">${escapeHtml(node.title || node.label)}</div>
          <div class="top-similar-meta">${escapeHtml(node.artist || '')} · ${toDisplayScore(avgScore).toFixed(2)}</div>
          <div class="top-similar-views">${views}</div>
        </div>
      `;
      li.addEventListener('click', () => onItemClick?.(node));
      li.addEventListener('mouseenter', () => onItemHover?.(node.id));
      li.addEventListener('mouseleave', () => onItemHover?.(null));
      listEl.appendChild(li);
    }
  }
}
