// Minimal observable store — the only "framework" piece in this app.
export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(patch) {
    // The function form must also merge, not replace — a functional updater
    // returns a partial patch (e.g. { version: s.version + 1 }), not the
    // entire next state. Replacing wholesale silently discards every other
    // field on each call.
    const partial = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...partial };
    listeners.forEach((listener) => listener(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}
