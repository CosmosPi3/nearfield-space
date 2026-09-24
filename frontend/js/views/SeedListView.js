import { escapeHtml } from './domUtils.js';
import { thumbnailImgHtml } from './thumbnail.js';

const STATUS_LABEL = { pending: ' (loading…)', unavailable: ' (unavailable)', error: ' (error)' };

export function createSeedListView({ listEl, graphViewModel, onItemClick, onItemHover }) {
  graphViewModel.subscribe(render);
  render();

  function render() {
    const seeds = graphViewModel.getSeedNodes();
    listEl.innerHTML = '';
    for (const seed of seeds) {
      const li = document.createElement('li');
      const statusLabel = STATUS_LABEL[seed.status] || '';
      li.innerHTML = `
        ${thumbnailImgHtml(seed.videoId)}
        <div class="seed-text">
          <div class="seed-title">${escapeHtml(seed.title || seed.label)}</div>
          <div class="seed-meta">${escapeHtml(seed.artist || '')}${statusLabel}</div>
        </div>
      `;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-seed';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove seed';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't also trigger the li's click-to-open below
        graphViewModel.unpinTrack(seed.id);
      });
      li.appendChild(removeBtn);
      li.addEventListener('click', () => onItemClick?.(seed));
      li.addEventListener('mouseenter', () => onItemHover?.(seed.id));
      li.addEventListener('mouseleave', () => onItemHover?.(null));
      listEl.appendChild(li);
    }
  }
}
