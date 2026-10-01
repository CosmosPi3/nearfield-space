import { createStore } from './store.js';
import * as api from '../services/api.js';
import { showToast } from '../views/toast.js';

export function createFavouritesViewModel() {
  const store = createStore({ trackIds: new Set() });

  async function hydrate() {
    const trackIds = await api.getFavorites();
    store.setState({ trackIds: new Set(trackIds) });
  }

  function isFavourited(trackId) {
    return store.getState().trackIds.has(trackId);
  }

  // Optimistic: flips locally (and notifies subscribers) before the request
  // resolves, so both popups' hearts react immediately -- reverted with an
  // error toast if the backend call actually fails.
  async function toggleFavourite(trackId) {
    const wasFavourited = isFavourited(trackId);
    setFavourited(trackId, !wasFavourited);
    // Added gets the pink "favourite" treatment; removed stays the plain/
    // neutral toast style rather than reusing the green success variant.
    if (wasFavourited) showToast('Removed from favourites');
    else showToast('Added to favourites', { variant: 'favourite' });

    try {
      if (wasFavourited) await api.removeFavorite(trackId);
      else await api.addFavorite(trackId);
    } catch (err) {
      setFavourited(trackId, wasFavourited);
      showToast('Could not update favourites — please try again', { variant: 'error' });
    }
  }

  function setFavourited(trackId, favourited) {
    const trackIds = new Set(store.getState().trackIds);
    if (favourited) trackIds.add(trackId);
    else trackIds.delete(trackId);
    store.setState({ trackIds });
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    hydrate,
    isFavourited,
    toggleFavourite,
  };
}
