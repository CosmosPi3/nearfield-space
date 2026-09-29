let containerEl = null;

function getContainer() {
  if (!containerEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'toast-container';
    document.body.appendChild(containerEl);
  }
  return containerEl;
}

// duration: null keeps the toast up indefinitely (until the caller calls
// dismiss() on the returned handle) — used for a long-running "in progress"
// message that gets its text updated live, rather than a fire-and-forget one.
// variant: an optional feature-scoped color treatment (see style.css's
// .toast-<variant> rules), e.g. 'autoplay' or 'discovery', so a toast reads
// as belonging to the feature that raised it rather than all looking generic.
export function showToast(message, { duration = 2500, variant } = {}) {
  const container = getContainer();
  const toastEl = document.createElement('div');
  toastEl.className = variant ? `toast toast-${variant}` : 'toast';
  toastEl.textContent = message;
  container.appendChild(toastEl);

  // Forces the browser to register the initial (opacity:0) state before the
  // .visible transition kicks in — adding both classes in the same tick would
  // otherwise collapse into one paint and skip the fade-in.
  requestAnimationFrame(() => toastEl.classList.add('visible'));

  function fadeOutAndRemove() {
    toastEl.classList.remove('visible');
    toastEl.addEventListener('transitionend', () => toastEl.remove(), { once: true });
  }

  const timeoutHandle = duration != null ? setTimeout(fadeOutAndRemove, duration) : null;

  return {
    update(newMessage) {
      toastEl.textContent = newMessage;
    },
    dismiss() {
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
      fadeOutAndRemove();
    },
  };
}
