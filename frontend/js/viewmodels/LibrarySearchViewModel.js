import { createStore } from './store.js';

const MAX_RESULTS = 20;

// Unlike SearchViewModel, this never hits the network — every track it can
// match against is already sitting in libraryGraphViewModel's state (the
// Library tab loads the whole DB up front), so filtering is a synchronous
// substring match, not a debounced fetch.
export function createLibrarySearchViewModel({ libraryGraphViewModel }) {
  const store = createStore({ query: '', results: [] });

  function setQuery(query) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      store.setState({ query, results: [] });
      return;
    }
    const { nodes } = libraryGraphViewModel.getState();
    const results = nodes
      .filter((n) => (n.artist || '').toLowerCase().includes(trimmed) || (n.track || n.name || '').toLowerCase().includes(trimmed))
      .slice(0, MAX_RESULTS);
    store.setState({ query, results });
  }

  function clear() {
    store.setState({ query: '', results: [] });
  }

  return { getState: store.getState, subscribe: store.subscribe, setQuery, clear };
}
