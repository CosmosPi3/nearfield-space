import { escapeHtml } from './domUtils.js';

export function thumbnailUrl(videoId) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
}

export function thumbnailImgHtml(videoId, { imgClass = '', fallbackClass = null } = {}) {
  const url = thumbnailUrl(videoId);
  if (url) return `<img${imgClass ? ` class="${imgClass}"` : ''} src="${escapeHtml(url)}" alt="" loading="lazy" />`;
  return fallbackClass ? `<div class="${fallbackClass}"></div>` : '';
}
