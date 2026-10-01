import { escapeHtml } from './domUtils.js';
import { thumbnailImgHtml } from './thumbnail.js';

function trackTitle(node) {
  return node.track || node.name || 'Untitled';
}

// Each comparator sorts ascending; a 'desc' direction just reverses the
// already-sorted result rather than needing its own inverted comparator.
// All three show direction via the same fa-arrow icon (up = ascending, down
// = descending) rather than spelling it out, so the label itself (A-Z/BPM/
// Views) never changes — just which arrow is showing.
const SORT_DEFS = {
  alpha: { label: 'A-Z', defaultDir: 'asc',
    compare: (a, b) => trackTitle(a).localeCompare(trackTitle(b)) },
  bpm: { label: 'BPM', defaultDir: 'desc',
    compare: (a, b) => (a.tempoBpm ?? -Infinity) - (b.tempoBpm ?? -Infinity) },
  views: { label: 'Views', defaultDir: 'desc',
    compare: (a, b) => (a.viewCount ?? -Infinity) - (b.viewCount ?? -Infinity) },
};

// Favourites are just a Set of track ids (see FavouritesViewModel.js) — this
// resolves display data (title/artist/thumbnail/views/BPM) by cross-
// referencing libraryGraphViewModel's already-loaded nodes rather than a
// dedicated endpoint, since a track can only be favourited from a popup
// that's already showing it fully extracted (i.e. already present in the
// library).
export function createFavouritesListView({ listEl, sortButtonsEl, favouritesViewModel, libraryGraphViewModel, onItemClick }) {
  // A-Z ascending is the default, active sort on load, not an "unsorted"
  // state — there's always exactly one active sort/direction; clicking the
  // already-active button flips its direction, clicking another switches to
  // it at its own default direction.
  let activeSort = 'alpha';
  let activeDir = SORT_DEFS.alpha.defaultDir;

  const sortButtons = [...sortButtonsEl.querySelectorAll('.favourites-sort-button')];
  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (activeSort === key) {
        activeDir = activeDir === 'asc' ? 'desc' : 'asc';
      } else {
        activeSort = key;
        activeDir = SORT_DEFS[key].defaultDir;
      }
      updateSortButtons();
      render();
    });
  });
  updateSortButtons();

  function updateSortButtons() {
    for (const btn of sortButtons) {
      const key = btn.dataset.sort;
      const def = SORT_DEFS[key];
      const isActive = key === activeSort;
      btn.classList.toggle('active', isActive);
      const dir = isActive ? activeDir : def.defaultDir;
      btn.innerHTML = `${def.label} <i class="fa-solid fa-arrow-${dir === 'asc' ? 'up' : 'down'}" aria-hidden="true"></i>`;
    }
  }

  favouritesViewModel.subscribe(render);
  libraryGraphViewModel.subscribe(render);
  render();

  function render() {
    const favouriteIds = favouritesViewModel.getState().trackIds;
    const { nodes } = libraryGraphViewModel.getState();
    const nodeLookup = new Map(nodes.map((n) => [n.id, n]));
    const favourites = [...favouriteIds].map((id) => nodeLookup.get(id)).filter(Boolean);
    favourites.sort(SORT_DEFS[activeSort].compare);
    if (activeDir === 'desc') favourites.reverse();

    if (favourites.length === 0) {
      listEl.innerHTML = '<p class="hint">No favourites yet — tap the heart on any track to add it here.</p>';
      return;
    }

    listEl.innerHTML = '';
    for (const node of favourites) {
      const li = document.createElement('li');
      const metaParts = [escapeHtml(node.artist || '')];
      if (node.viewCount != null) metaParts.push(`${node.viewCount.toLocaleString()} views`);
      if (node.tempoBpm != null) metaParts.push(`${node.tempoBpm.toFixed(0)} BPM`);
      li.innerHTML = `
        ${thumbnailImgHtml(node.videoId)}
        <div class="favourite-text">
          <div class="favourite-title">${escapeHtml(trackTitle(node))}</div>
          <div class="favourite-meta">${metaParts.join(' · ')}</div>
        </div>
      `;
      li.addEventListener('click', () => onItemClick?.(node));
      listEl.appendChild(li);
    }
  }
}
