// Single source of truth for the mobile breakpoint — must match the
// @media (max-width: 768px) convention in style.css so JS-driven sizing
// (e.g. graph node hit-targets) agrees with the CSS layout it's reacting to.
const MOBILE_QUERY = '(max-width: 768px)';

export function isMobileViewport() {
  return window.matchMedia(MOBILE_QUERY).matches;
}
