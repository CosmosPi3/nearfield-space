import { escapeHtml } from './domUtils.js';
import { toDisplayScore } from './scoreDisplay.js';
import { thumbnailImgHtml } from './thumbnail.js';

// Placeholder only — the real player DOM (iframe + custom mini controls) is
// owned by a persistent node created in miniPlayer.js, which the panel
// swaps in after setting this innerHTML (see NodeDetailPanel/LibraryNodePopup).
export function videoSlotHtml(videoId) {
  if (!videoId) return '';
  return `<div class="popup-video-slot" data-video-id="${escapeHtml(videoId)}"></div>`;
}

export function statsChipsHtml({ tempoBpm, features, rms }) {
  return `
    <div class="popup-chips">
      <div class="popup-chip"><span class="popup-chip-value">${tempoBpm.toFixed(0)}</span><span class="popup-chip-label">BPM</span></div>
      <div class="popup-chip"><span class="popup-chip-value">${features.centroid.mean.toFixed(0)}</span><span class="popup-chip-label">Bright</span></div>
      <div class="popup-chip"><span class="popup-chip-value">${features.flatness.mean.toFixed(3)}</span><span class="popup-chip-label">Noisy</span></div>
      <div class="popup-chip"><span class="popup-chip-value">${rms.mean.toFixed(3)}</span><span class="popup-chip-label">Loud</span></div>
    </div>`;
}

// The YouTube video link is skipped since it's already embedded above as a
// player, not just a link out.
export function externalLinkHtml({ externalLink, source }) {
  if (!externalLink || !source || source === 'YouTube') return '';
  return `<a class="popup-external-link" href="${escapeHtml(externalLink)}" target="_blank" rel="noopener">View on ${escapeHtml(source)} ↗</a>`;
}

// Font Awesome's actual brand marks (fa-brands), rather than hand-rolled
// approximations — https://fontawesome.com is loaded globally via CDN in
// index.html. Tidal's brand mark (fa-tidal) is Pro-only and not in the Free
// bundle we load, so it uses a generic fa-solid icon instead.
const SEARCH_ICON_CLASS = {
  Bandcamp: 'fa-brands fa-bandcamp',
  Spotify: 'fa-brands fa-spotify',
  SoundCloud: 'fa-brands fa-soundcloud',
  'Apple Music': 'fa-brands fa-itunes-note',
  Tidal: 'fa-solid fa-water',
};

// Best-effort search-by-title-and-artist, not a confirmed link — one icon per
// platform we don't otherwise have a real link for.
const SEARCH_PLATFORMS = [
  { label: 'Bandcamp', url: (q) => `https://bandcamp.com/search?q=${q}` },
  { label: 'Spotify', url: (q) => `https://open.spotify.com/search/${q}` },
  { label: 'SoundCloud', url: (q) => `https://soundcloud.com/search?q=${q}` },
  { label: 'Apple Music', url: (q) => `https://music.apple.com/search?term=${q}` },
  { label: 'Tidal', url: (q) => `https://tidal.com/search?q=${q}` },
];

function searchIconHtml(label, href) {
  return `<a class="popup-search-icon" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="Search on ${escapeHtml(label)}"><i class="${SEARCH_ICON_CLASS[label]}" aria-hidden="true"></i></a>`;
}

export function searchIconsHtml({ artist, title }) {
  if (!artist && !title) return '';
  const q = encodeURIComponent(`${artist || ''} ${title || ''}`.trim());
  return SEARCH_PLATFORMS.map((p) => searchIconHtml(p.label, p.url(q))).join('');
}

// Small red/pink heart shown next to a track's title wherever it appears in
// a list, purely a status indicator (not clickable) — only rendered at all
// when the track is favourited, per FavouritesViewModel.js.
export function favouriteHeartHtml(favourited) {
  return favourited ? '<i class="fa-solid fa-heart favourite-indicator" aria-hidden="true"></i>' : '';
}

// Patches the two clickable favourite buttons for the panel's own current
// track in place — used instead of a full re-render so a favourite toggle
// elsewhere in the app never detaches/reattaches the miniPlayer's element
// (which would reload the YouTube iframe and reset playback).
export function syncFavouriteButtons(panelEl, favourited) {
  [
    ['.popup-header-favourite', 'popup-header-favourite-active'],
    ['.popup-favourite', 'popup-favourite-active'],
  ].forEach(([selector, activeClass]) => {
    const btn = panelEl.querySelector(selector);
    if (!btn) return;
    btn.classList.toggle(activeClass, favourited);
    btn.title = favourited ? 'Unfavourite' : 'Favourite';
    const icon = btn.querySelector('i');
    icon?.classList.toggle('fa-solid', favourited);
    icon?.classList.toggle('fa-regular', !favourited);
  });
}

// Patches the pin buttons in place, for the same reason as
// syncFavouriteButtons above — pinning/unpinning must never detach/reattach
// the miniPlayer's element via a full re-render. No icon swap needed, unlike
// the heart: the thumbtack icon is the same fa-solid glyph in both states.
export function syncPinButtons(panelEl, isPinned) {
  [
    ['.popup-header-pin', 'popup-header-pin-active'],
    ['.popup-pin', 'popup-pin-active'],
  ].forEach(([selector, activeClass]) => {
    const btn = panelEl.querySelector(selector);
    if (!btn) return;
    btn.classList.toggle(activeClass, isPinned);
    btn.title = isPinned ? 'Unpin' : 'Pin';
  });
}

// Patches the Discover button's disabled state and label in place, for the
// same reason as above — Discover's progress ticks fire far more often than
// pin/unpin ever would, so this matters even more there.
export function syncDiscoverButton(panelEl, { disabled, discovering }) {
  const btn = panelEl.querySelector('.popup-discover');
  if (!btn) return;
  btn.disabled = disabled;
  const label = btn.querySelector('.popup-discover-label');
  if (label) label.textContent = discovering ? 'Discovering…' : 'Discover';
}

// Patches the non-clickable heart indicators next to tracks in the
// relations/neighbors lists in place, for the same reason as above.
export function syncFavouriteIndicators(panelEl, isFavourited) {
  panelEl.querySelectorAll('[data-node-id]').forEach((el) => {
    const titleEl = el.querySelector('.popup-relation-title, .popup-found-via-title');
    if (!titleEl) return;
    const favourited = isFavourited(el.dataset.nodeId);
    const existingIcon = titleEl.querySelector('.favourite-indicator');
    if (favourited && !existingIcon) {
      titleEl.insertAdjacentHTML('beforeend', favouriteHeartHtml(true));
    } else if (!favourited && existingIcon) {
      existingIcon.remove();
    }
  });
}

// A compact version of the #top-similar-list row pattern (thumbnail + title +
// one meta line), used for "Discovered via this track" (0-N entries). Both
// `score` (ours) and `cosineScore` (cosine.club's) live on the edge itself,
// not either node, since a node can have several parents/children each with
// their own scores for that specific relationship.
function relationItemHtml(relNode, score, cosineScore, favourited) {
  const nearfieldText = score != null ? `<span class="popup-relation-score-nearfield">nearfield ${toDisplayScore(score).toFixed(2)}</span>` : '';
  const cosineText = cosineScore != null ? `<span class="popup-relation-score-cosine">cosine.club ${cosineScore.toFixed(2)}</span>` : '';
  const scoresLine = (nearfieldText || cosineText)
    ? `<div class="popup-relation-scores">${nearfieldText}${nearfieldText && cosineText ? ' · ' : ''}${cosineText}</div>`
    : '';
  return `
    <li class="popup-relation-item" data-node-id="${escapeHtml(relNode.id)}">
      ${thumbnailImgHtml(relNode.videoId, { fallbackClass: 'popup-relation-thumb-fallback' })}
      <div class="popup-relation-text">
        <div class="popup-relation-title">${escapeHtml(relNode.title || relNode.label)}${favouriteHeartHtml(favourited)}</div>
        <div class="popup-relation-meta">${escapeHtml(relNode.artist || '')}</div>
        ${scoresLine}
      </div>
    </li>`;
}

// A larger, standalone card for "Found via" (0-N — a track can be surfaced
// by more than one independent discovery run) — typically few enough that
// each can afford more room than the compact list rows above, and puts
// cosine.club's score on its own line to make the ours-vs-cosine.club
// comparison easier to spot at a glance.
function foundViaCardHtml(relNode, score, cosineScore, favourited) {
  const scoreText = score != null ? ` · ${toDisplayScore(score).toFixed(2)}` : '';
  return `
    <div class="popup-found-via-card" data-node-id="${escapeHtml(relNode.id)}">
      ${thumbnailImgHtml(relNode.videoId, { imgClass: 'popup-found-via-thumb', fallbackClass: 'popup-found-via-thumb popup-relation-thumb-fallback' })}
      <div class="popup-found-via-text">
        <div class="popup-found-via-title">${escapeHtml(relNode.title || relNode.label)}${favouriteHeartHtml(favourited)}</div>
        <div class="popup-found-via-meta">${escapeHtml(relNode.artist || '')}${scoreText}</div>
        ${cosineScore != null ? `<div class="popup-found-via-cosine">cosine.club ${cosineScore.toFixed(2)}</div>` : ''}
      </div>
    </div>`;
}

function relationSectionHtml(title, itemsHtml, { scrollable = false } = {}) {
  if (!itemsHtml) return '';
  return `
    <div class="popup-section">
      <div class="popup-section-title">${escapeHtml(title)}</div>
      <ul class="popup-relation-list${scrollable ? ' popup-relation-list-scroll' : ''}">${itemsHtml}</ul>
    </div>`;
}

// "Found via" + "Discovered via this track" — relations are tied to the
// workspace exploration session (recorded discovery edges), not a property
// of the track itself, so this needs graphState, not just a node id. Used
// both by the workspace's own NodeDetailPanel and by the library graph's
// popup, for any library track that also happens to already be a workspace
// node (has been pinned/discovered at some point).
export function relationsHtml(graphState, nodeId, isFavourited) {
  // 0-N: a track can be surfaced by more than one independent discovery run
  // (from different pinned seeds), so this is a list, not a single lookup —
  // see GraphState.parentsOf.
  const parents = graphState.parentsOf(nodeId, 'discovered-via')
    .map(({ parentId, similarity, cosineScore }) => ({ node: graphState.nodes.get(parentId), similarity, cosineScore }))
    .filter((p) => p.node)
    .sort((a, b) => (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity));
  const foundViaCardsHtml = parents.map(({ node: n, similarity, cosineScore }) => foundViaCardHtml(n, similarity, cosineScore, isFavourited(n.id))).join('');
  const foundViaHtml = foundViaCardsHtml
    ? `<div class="popup-section"><div class="popup-section-title">Found via</div>${foundViaCardsHtml}</div>`
    : '';

  // The reverse relationship has no such limit either — one node can be the
  // "via" parent for many candidates (up to `branching` per hop, more across
  // hops/repeated Discover clicks), so this list is 0-N too.
  const discoveredVia = graphState.childrenOf(nodeId, 'discovered-via')
    .map(({ childId, similarity, cosineScore }) => ({ node: graphState.nodes.get(childId), score: similarity, cosineScore }))
    .filter((c) => c.node)
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const discoveredViaHtml = discoveredVia.map(({ node: n, score, cosineScore }) => relationItemHtml(n, score, cosineScore, isFavourited(n.id))).join('');

  return foundViaHtml + relationSectionHtml('Discovered via this track', discoveredViaHtml, { scrollable: discoveredVia.length > 5 });
}

// A track's neighbors in the *current* similarity graph (i.e. this graph's
// live edges above whatever threshold is active) — distinct from
// relationsHtml's workspace-only "Found via"/"Discovered via", which only
// exists for a track that's already been pinned/discovered into the
// workspace. This is the library graph's equivalent: "what else in the
// catalog is this connected to right now". Shows the raw cosine score
// directly (not the [0,1]-remapped toDisplayScore used elsewhere) since the
// library's own "Min similarity" slider already operates in raw cosine
// terms end-to-end.
export function neighborsSectionHtml(neighbors, isFavourited) {
  if (!neighbors.length) return '';
  const itemsHtml = neighbors.map(({ node, cosineScore }) => {
    return `
      <li class="popup-relation-item" data-node-id="${escapeHtml(node.id)}">
        ${thumbnailImgHtml(node.videoId, { fallbackClass: 'popup-relation-thumb-fallback' })}
        <div class="popup-relation-text">
          <div class="popup-relation-title">${escapeHtml(node.track || node.name || 'Untitled')}${favouriteHeartHtml(isFavourited(node.id))}</div>
          <div class="popup-relation-meta">${escapeHtml(node.artist || '')} · ${cosineScore.toFixed(2)}</div>
        </div>
      </li>`;
  }).join('');
  return relationSectionHtml('Similar tracks', itemsHtml, { scrollable: neighbors.length > 5 });
}
