import { escapeHtml } from './domUtils.js';

// Takes over the same #search-input/#search-results elements as SearchView
// while the Library tab is active (see SearchView.js's own comment on the
// handoff) — simpler than that view since there's no manual-add/error state,
// just a local list of matches.
export function createLibrarySearchView({ inputEl, dropdownEl, librarySearchViewModel, onSelect }) {
  let active = false;

  inputEl.addEventListener('input', () => {
    if (active) librarySearchViewModel.setQuery(inputEl.value);
  });
  document.addEventListener('click', (e) => {
    if (active && !dropdownEl.contains(e.target) && e.target !== inputEl) {
      dropdownEl.classList.add('hidden');
    }
  });

  librarySearchViewModel.subscribe(render);

  function setActive(value) {
    active = value;
    if (active) render(librarySearchViewModel.getState());
    else dropdownEl.classList.add('hidden');
  }

  function render(state) {
    if (!active) return;
    dropdownEl.innerHTML = '';

    if (!state.results.length) {
      dropdownEl.classList.add('hidden');
      return;
    }
    dropdownEl.classList.remove('hidden');
    for (const track of state.results) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="track-title">${escapeHtml(track.track || track.name)}</div>` +
        `<div class="track-artist">${escapeHtml(track.artist || '')}</div>`;
      li.addEventListener('click', () => {
        onSelect(track);
        inputEl.value = '';
        librarySearchViewModel.clear();
      });
      dropdownEl.appendChild(li);
    }
  }

  return { setActive };
}
