import { createStore } from './store.js';
import * as api from '../services/api.js';

const DEBOUNCE_MS = 300;

// cosine.club's /tracks/lookup natively supports these — Spotify is
// deliberately absent (confirmed via a live 400: "URL is from a source
// cosine does not carry. Supported: YouTube, Discogs, Bandcamp, Nina,
// SoundCloud") and is handled separately below via oEmbed + text search.
const PLATFORM_HOSTS = {
  youtube: [/youtube\.com$/i, /youtu\.be$/i],
  discogs: [/discogs\.com$/i],
  bandcamp: [/bandcamp\.com$/i],
  nina: [/nina\.?(?:protocol)?\.com$/i],
  soundcloud: [/soundcloud\.com$/i],
  spotify: [/spotify\.com$/i],
};

// A track missing from cosine.club's catalog can only be added directly
// (bypassing cosine.club, via our own yt-dlp pipeline) if it's from one of
// these — Discogs/Nina aren't audio sources, and Spotify blocks extraction.
const EXTRACTABLE_PLATFORMS = new Set(['youtube', 'bandcamp', 'soundcloud']);

function detectPlatform(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null; // not a URL at all — treat as a normal text query
  }
  for (const [platform, patterns] of Object.entries(PLATFORM_HOSTS)) {
    if (patterns.some((p) => p.test(url.hostname))) return platform;
  }
  return null;
}

// Spotify's oEmbed is public/key-less but only gives a bare track title (no
// artist) — good enough to seed a normal text search, where the dropdown
// lets the user visually confirm the right match, same as typing manually.
async function resolveSpotifyQuery(url) {
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error('Could not resolve that Spotify link');
  const data = await res.json();
  if (!data.title) throw new Error('Spotify link did not resolve to a track title');
  return data.title;
}

export function createSearchViewModel() {
  const store = createStore({ query: '', results: [], loading: false, error: null, manualAddUrl: null });
  let debounceTimer = null;

  async function runTextSearch(query) {
    store.setState({ loading: true, error: null, manualAddUrl: null });
    try {
      const results = await api.search(query);
      store.setState({ results, loading: false });
    } catch (err) {
      store.setState({ results: [], loading: false, error: err.message });
    }
  }

  async function runLinkLookup(input, platform) {
    store.setState({ loading: true, error: null, manualAddUrl: null });
    try {
      const results = platform === 'spotify'
        ? await api.search(await resolveSpotifyQuery(input))
        : await api.lookupByUrl(input);

      if (results.length === 0 && EXTRACTABLE_PLATFORMS.has(platform)) {
        // Not in cosine.club's catalog, but we can still analyze it directly.
        store.setState({ results: [], loading: false, manualAddUrl: input });
      } else {
        store.setState({ results, loading: false });
      }
    } catch (err) {
      store.setState({ results: [], loading: false, error: err.message });
    }
  }

  function setQuery(query) {
    clearTimeout(debounceTimer);
    store.setState({ query });
    const trimmed = query.trim();
    if (!trimmed) {
      store.setState({ results: [], error: null, manualAddUrl: null });
      return;
    }
    const platform = detectPlatform(trimmed);
    if (platform) {
      runLinkLookup(trimmed, platform); // pasting a full link is deliberate — no debounce
      return;
    }
    debounceTimer = setTimeout(() => runTextSearch(trimmed), DEBOUNCE_MS);
  }

  function clear() {
    clearTimeout(debounceTimer);
    store.setState({ query: '', results: [], error: null, manualAddUrl: null });
  }

  return { getState: store.getState, subscribe: store.subscribe, setQuery, clear };
}
