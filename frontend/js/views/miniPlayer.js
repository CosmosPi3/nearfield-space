import { loadYouTubeIframeApi } from '../services/youtubeIframeApi.js';

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Owns a persistent DOM subtree (video + custom overlay controls) and the
// YT.Player living inside it. Callers insert/detach/reattach `element`
// across their own re-renders as needed — this module never destroys the
// player just because its element was temporarily unmounted, only when
// `destroy()` is called explicitly (track switched, or panel closed).
export function createMiniPlayer(videoId) {
  const element = document.createElement('div');
  element.className = 'popup-video mini-player';
  element.innerHTML = `
    <div class="mini-player-frame"></div>
    <div class="mini-player-controls">
      <button class="mini-player-toggle" title="Play"><i class="fa-solid fa-play" aria-hidden="true"></i></button>
      <div class="mini-player-scrub"><div class="mini-player-scrub-fill"></div></div>
      <span class="mini-player-time">0:00</span>
    </div>`;

  const frameEl = element.querySelector('.mini-player-frame');
  const toggleEl = element.querySelector('.mini-player-toggle');
  const toggleIconEl = toggleEl.querySelector('i');
  const scrubEl = element.querySelector('.mini-player-scrub');
  const scrubFillEl = element.querySelector('.mini-player-scrub-fill');
  const timeEl = element.querySelector('.mini-player-time');

  let player = null;
  let destroyed = false;
  let pollHandle = null;
  let dragging = false;

  function setPlayingIcon(isPlaying) {
    toggleIconEl.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    toggleEl.title = isPlaying ? 'Pause' : 'Play';
  }

  function updateProgress() {
    if (dragging || !player) return;
    const duration = player.getDuration();
    const current = player.getCurrentTime();
    if (duration) scrubFillEl.style.width = `${clamp((current / duration) * 100, 0, 100)}%`;
    timeEl.textContent = formatTime(current);
  }

  function startPolling() {
    stopPolling();
    pollHandle = setInterval(updateProgress, 250);
  }

  function stopPolling() {
    if (pollHandle != null) clearInterval(pollHandle);
    pollHandle = null;
  }

  function handleStateChange(e) {
    const isPlaying = e.data === window.YT.PlayerState.PLAYING;
    setPlayingIcon(isPlaying);
    if (isPlaying) startPolling();
    else stopPolling();
  }

  toggleEl.addEventListener('click', () => {
    if (!player) return;
    if (player.getPlayerState() === window.YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  });

  function seekFromEvent(clientX) {
    const rect = scrubEl.getBoundingClientRect();
    const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
    scrubFillEl.style.width = `${fraction * 100}%`;
    if (!player) return;
    const duration = player.getDuration();
    if (duration) {
      player.seekTo(fraction * duration, true);
      timeEl.textContent = formatTime(fraction * duration);
    }
  }

  scrubEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrubEl.classList.add('dragging');
    scrubEl.setPointerCapture(e.pointerId);
    seekFromEvent(e.clientX);
  });
  scrubEl.addEventListener('pointermove', (e) => {
    if (dragging) seekFromEvent(e.clientX);
  });
  scrubEl.addEventListener('pointerup', () => {
    dragging = false;
    scrubEl.classList.remove('dragging');
  });
  scrubEl.addEventListener('pointercancel', () => {
    dragging = false;
    scrubEl.classList.remove('dragging');
  });

  loadYouTubeIframeApi().then((YT) => {
    if (destroyed) return;
    player = new YT.Player(frameEl, {
      playerVars: { controls: 0, modestbranding: 1, rel: 0, playsinline: 1, disablekb: 1 },
      videoId,
      events: { onStateChange: handleStateChange },
    });
    // YT.Player replaces `frameEl` outright with a bare <iframe> (it doesn't
    // nest one inside it) using YouTube's default 640x390 sizing — grab the
    // generated iframe directly so it can be sized to fill this container.
    player.getIframe().classList.add('mini-player-iframe');
  });

  function destroy() {
    destroyed = true;
    stopPolling();
    player?.destroy();
    player = null;
  }

  return { element, videoId, destroy };
}
