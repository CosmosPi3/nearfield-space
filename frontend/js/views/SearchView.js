import { escapeHtml } from './domUtils.js';

// The shared #search-input/#search-results elements are handed off between
// this view and LibrarySearchView depending on which tab is active — `active`
// gates both the input listener and rendering so an inactive instance never
// steps on the other's dropdown while its query state sits idle in the
// background.
export function createSearchView({ inputEl, dropdownEl, searchViewModel, onSelect, onManualAdd }) {
  let active = true;

  inputEl.addEventListener('input', () => {
    if (active) searchViewModel.setQuery(inputEl.value);
  });
  document.addEventListener('click', (e) => {
    if (active && !dropdownEl.contains(e.target) && e.target !== inputEl) {
      dropdownEl.classList.add('hidden');
    }
  });

  searchViewModel.subscribe(render);
  render(searchViewModel.getState());

  function setActive(value) {
    active = value;
    if (active) render(searchViewModel.getState());
    else dropdownEl.classList.add('hidden');
  }

  function render(state) {
    if (!active) return;
    dropdownEl.innerHTML = '';

    if (state.manualAddUrl) {
      dropdownEl.classList.remove('hidden');
      const li = document.createElement('li');
      li.className = 'dropdown-manual-add';
      li.innerHTML = `<div class="track-title">+ Not in cosine.club's catalog</div>` +
        `<div class="track-artist">Click to analyze this link directly (~10-20s)</div>`;
      li.addEventListener('click', () => {
        onManualAdd(state.manualAddUrl);
        inputEl.value = '';
        searchViewModel.clear();
      });
      dropdownEl.appendChild(li);
      return;
    }

    if (!state.results.length) {
      if (state.error) {
        dropdownEl.classList.remove('hidden');
        const li = document.createElement('li');
        li.className = 'dropdown-error';
        li.textContent = state.error;
        dropdownEl.appendChild(li);
      } else {
        dropdownEl.classList.add('hidden');
      }
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
        searchViewModel.clear();
      });
      dropdownEl.appendChild(li);
    }
  }

  return { setActive };
}
