// Custom dual-thumb range slider — built from scratch with pointer events
// rather than two overlapping native <input type="range">s, which need
// hit-testing hacks to route a click to whichever thumb is nearer and don't
// hold up well on touch. No UI library exists in this codebase to lean on
// instead.
//
// Supports a 'log' scale (mapping through log10(value + 1)) alongside the
// default 'linear' one, for attributes like view counts that span orders of
// magnitude — mirrors the log10(viewCount + 1) precedent already used for
// node sizing in graphRenderHelpers.js.

const KEYBOARD_LOG_STEP_PERCENT = 1;
// Must match .range-slider-thumb's width in style.css.
const THUMB_SIZE = 16;

function makeScale(scale, min, max) {
  if (scale === 'log') {
    const lo = Math.log10(min + 1);
    const hi = Math.log10(max + 1);
    const span = hi - lo || 1e-9;
    return {
      toPercent(value) {
        return ((Math.log10(value + 1) - lo) / span) * 100;
      },
      toValue(percent) {
        return Math.pow(10, lo + (percent / 100) * span) - 1;
      },
    };
  }
  const span = max - min || 1e-9;
  return {
    toPercent(value) {
      return ((value - min) / span) * 100;
    },
    toValue(percent) {
      return min + (percent / 100) * span;
    },
  };
}

function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), hi);
}

export function createRangeSlider({
  containerEl,
  min,
  max,
  step = 1,
  scale: scaleMode = 'linear',
  values: initialValues,
  format = (v) => String(v),
  debounceMs = 300,
  onInput = () => {},
  onChange = () => {},
}) {
  containerEl.innerHTML = `
    <div class="range-slider" data-scale="${scaleMode}">
      <div class="range-slider-track">
        <div class="range-slider-fill"></div>
        <div class="range-slider-thumb range-slider-thumb-min" role="slider" tabindex="0" aria-label="Minimum"></div>
        <div class="range-slider-thumb range-slider-thumb-max" role="slider" tabindex="0" aria-label="Maximum"></div>
      </div>
    </div>
  `;
  const rootEl = containerEl.querySelector('.range-slider');
  const trackEl = containerEl.querySelector('.range-slider-track');
  const fillEl = containerEl.querySelector('.range-slider-fill');
  const minThumbEl = containerEl.querySelector('.range-slider-thumb-min');
  const maxThumbEl = containerEl.querySelector('.range-slider-thumb-max');

  let bounds = { min, max };
  let scaleHelper = makeScale(scaleMode, bounds.min, bounds.max);
  let values = [...initialValues];
  let disabled = false;
  let debounceTimer = null;

  // The minimum real-unit gap enforced between the two thumbs — using `step`
  // itself means "at least one step apart", preventing them from visually
  // overlapping or crossing.
  function minGap() {
    return step;
  }

  function positionPercent(value) {
    return clamp(scaleHelper.toPercent(value), 0, 100);
  }

  // Positions the thumb's CENTER inset by half its own size from each edge
  // (8px..track_width-8px) rather than letting it range across the full
  // 0%..100% of the track — otherwise, at the min/max value, the thumb's
  // CIRCLE overhangs past the track's own edge (since only its center sits
  // at 0%/100%), which visibly pokes it out past the left-aligned label
  // above it. Matches how native <input type="range"> insets its thumb so
  // it never overhangs the control's own box.
  function centerPx(percent) {
    const trackWidth = trackEl.clientWidth;
    const inset = THUMB_SIZE / 2;
    return inset + (percent / 100) * Math.max(0, trackWidth - THUMB_SIZE);
  }

  function render() {
    const [lo, hi] = values;
    const loPx = centerPx(positionPercent(lo));
    const hiPx = centerPx(positionPercent(hi));
    minThumbEl.style.left = `${loPx}px`;
    maxThumbEl.style.left = `${hiPx}px`;
    fillEl.style.left = `${loPx}px`;
    fillEl.style.width = `${Math.max(0, hiPx - loPx)}px`;

    minThumbEl.setAttribute('aria-valuemin', bounds.min);
    minThumbEl.setAttribute('aria-valuemax', hi);
    minThumbEl.setAttribute('aria-valuenow', lo);
    minThumbEl.setAttribute('aria-valuetext', format(lo));
    maxThumbEl.setAttribute('aria-valuemin', lo);
    maxThumbEl.setAttribute('aria-valuemax', bounds.max);
    maxThumbEl.setAttribute('aria-valuenow', hi);
    maxThumbEl.setAttribute('aria-valuetext', format(hi));
  }

  function setThumbValue(which, rawValue) {
    const rounded = Math.round(rawValue / step) * step;
    let [lo, hi] = values;
    if (which === 'min') {
      lo = clamp(rounded, bounds.min, hi - minGap());
      if (lo > hi - minGap()) lo = hi - minGap();
    } else {
      hi = clamp(rounded, lo + minGap(), bounds.max);
      if (hi < lo + minGap()) hi = lo + minGap();
    }
    lo = clamp(lo, bounds.min, bounds.max);
    hi = clamp(hi, bounds.min, bounds.max);
    values = [Math.min(lo, hi), Math.max(lo, hi)];
    render();
    onInput(values[0], values[1]);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(values[0], values[1]), debounceMs);
  }

  function percentFromClientX(clientX) {
    const rect = trackEl.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  }

  function nearestThumb(percent) {
    const loPct = positionPercent(values[0]);
    const hiPct = positionPercent(values[1]);
    return Math.abs(percent - loPct) <= Math.abs(percent - hiPct) ? 'min' : 'max';
  }

  let activeThumb = null;

  function handlePointerDown(e) {
    if (disabled) return;
    const isThumb = e.target === minThumbEl || e.target === maxThumbEl;
    activeThumb = isThumb ? (e.target === minThumbEl ? 'min' : 'max') : nearestThumb(percentFromClientX(e.clientX));
    (isThumb ? e.target : trackEl).setPointerCapture?.(e.pointerId);
    setThumbValue(activeThumb, scaleHelper.toValue(percentFromClientX(e.clientX)));
    e.preventDefault();
  }

  function handlePointerMove(e) {
    if (disabled || !activeThumb) return;
    setThumbValue(activeThumb, scaleHelper.toValue(percentFromClientX(e.clientX)));
  }

  function handlePointerUp() {
    activeThumb = null;
  }

  function handleKeyDown(e) {
    if (disabled) return;
    const which = e.target === minThumbEl ? 'min' : 'max';
    const current = which === 'min' ? values[0] : values[1];
    let nextValue = null;
    if (e.key === 'Home') nextValue = bounds.min;
    else if (e.key === 'End') nextValue = bounds.max;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      nextValue =
        scaleMode === 'log'
          ? scaleHelper.toValue(positionPercent(current) - KEYBOARD_LOG_STEP_PERCENT)
          : current - step;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      nextValue =
        scaleMode === 'log'
          ? scaleHelper.toValue(positionPercent(current) + KEYBOARD_LOG_STEP_PERCENT)
          : current + step;
    }
    if (nextValue === null) return;
    e.preventDefault();
    setThumbValue(which, nextValue);
  }

  trackEl.addEventListener('pointerdown', handlePointerDown);
  trackEl.addEventListener('pointermove', handlePointerMove);
  trackEl.addEventListener('pointerup', handlePointerUp);
  trackEl.addEventListener('pointercancel', handlePointerUp);
  minThumbEl.addEventListener('keydown', handleKeyDown);
  maxThumbEl.addEventListener('keydown', handleKeyDown);

  // centerPx() bakes trackEl.clientWidth into each thumb's inline `left`
  // at render time — without this, resizing the track (viewport resize,
  // orientation change, or a responsive layout change) leaves the thumbs
  // at stale pixel offsets from the old width instead of following it.
  new ResizeObserver(() => render()).observe(trackEl);

  render();

  function setValues(lo, hi) {
    values = [clamp(Math.min(lo, hi), bounds.min, bounds.max), clamp(Math.max(lo, hi), bounds.min, bounds.max)];
    render();
  }

  // Called when the underlying data changes (e.g. a library reload shifts
  // the observed view-count range) — re-clamps the current selection into
  // the new bounds by default rather than leaving it pointing outside them.
  function setBounds(nextMin, nextMax, { clampValues = true } = {}) {
    bounds = { min: nextMin, max: nextMax };
    scaleHelper = makeScale(scaleMode, bounds.min, bounds.max);
    if (clampValues) {
      values = [clamp(values[0], bounds.min, bounds.max), clamp(values[1], bounds.min, bounds.max)];
    }
    render();
  }

  function setDisabled(next) {
    disabled = next;
    rootEl.classList.toggle('range-slider-disabled', disabled);
    minThumbEl.setAttribute('aria-disabled', String(disabled));
    maxThumbEl.setAttribute('aria-disabled', String(disabled));
    minThumbEl.tabIndex = disabled ? -1 : 0;
    maxThumbEl.tabIndex = disabled ? -1 : 0;
  }

  return { setValues, setBounds, setDisabled };
}
