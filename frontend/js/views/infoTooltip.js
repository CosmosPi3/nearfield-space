// Wires up `.info-icon[data-tooltip]` elements to a `position: fixed` tooltip
// positioned via getBoundingClientRect — a native `title` attribute is too
// easy to miss (small target, slow to appear) and a CSS ::after popup would
// get clipped by any scrollable ancestor (e.g. #sidebar's overflow-y: auto).
export function setupInfoTooltips(root = document) {
  let tooltipEl = null;
  let activeIcon = null;

  function show(icon) {
    hide(); // in case a different icon's tooltip (e.g. tapped, not hovered away from) is still open
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'info-tooltip';
    tooltipEl.textContent = icon.dataset.tooltip;
    document.body.appendChild(tooltipEl);
    activeIcon = icon;

    const iconRect = icon.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    let left = iconRect.left + iconRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));

    let top = iconRect.top - tooltipRect.height - 8;
    if (top < 8) top = iconRect.bottom + 8; // not enough room above -> flip below

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function hide() {
    tooltipEl?.remove();
    tooltipEl = null;
    activeIcon = null;
  }

  // Touch has no hover — mouseenter/mouseleave never fire, so tapping an
  // icon has to toggle the tooltip itself instead.
  function handleIconClick(icon) {
    if (activeIcon === icon) hide();
    else show(icon);
  }

  // Dismiss on a tap anywhere outside the icon/tooltip — without this, a
  // tapped-open tooltip on touch has no way to close short of tapping the
  // exact same icon again.
  function handleDocumentPointerDown(e) {
    if (activeIcon && !e.target.closest('.info-icon') && !e.target.closest('.info-tooltip')) hide();
  }

  root.querySelectorAll('.info-icon[data-tooltip]').forEach((icon) => {
    icon.addEventListener('mouseenter', () => show(icon));
    icon.addEventListener('mouseleave', hide);
    icon.addEventListener('focus', () => show(icon));
    icon.addEventListener('blur', hide);
    icon.addEventListener('click', () => handleIconClick(icon));
  });

  document.addEventListener('pointerdown', handleDocumentPointerDown);
}
