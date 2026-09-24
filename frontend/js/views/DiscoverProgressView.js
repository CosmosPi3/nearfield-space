export function createDiscoverProgressView({ el, graphViewModel }) {
  graphViewModel.subscribe(render);
  render();

  function render() {
    const { discovering, progress } = graphViewModel.getState();
    if (!discovering || !progress) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');

    const indeterminate = !progress.estimatedTotal;
    const pct = indeterminate ? 0 : Math.min(1, progress.processed / progress.estimatedTotal) * 100;

    el.classList.toggle('indeterminate', indeterminate);
    el.innerHTML = `
      <div class="discover-progress-spinner"></div>
      <div class="discover-progress-text">Discovering… hop ${progress.hop}/${progress.depth}, ${progress.processed} candidates processed</div>
      <div class="discover-progress-bar"><div class="discover-progress-fill" style="width: ${pct}%"></div></div>
    `;
  }
}
