// Lazily loads the YouTube IFrame Player API script (never eagerly, since
// most sessions won't ever open a track panel) and resolves once
// window.YT.Player is actually usable. Idempotent — safe to call from every
// mini player instance.
let apiPromise = null;

export function loadYouTubeIframeApi() {
  if (apiPromise) return apiPromise;

  if (window.YT?.Player) {
    apiPromise = Promise.resolve(window.YT);
    return apiPromise;
  }

  apiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve(window.YT);
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return apiPromise;
}
