import { showToast } from './toast.js';

// Replaces the old #discover-progress-overlay: one persistent, live-updating
// toast for the whole run (progress only ever carries counts, never node
// identity — see GraphViewModel.js), plus a brief toast for every node as
// it's found, via the dedicated onNodeDiscovered channel.
export function setupDiscoveryToasts({ graphViewModel }) {
  let progressToast = null;

  graphViewModel.subscribe(() => {
    const { discovering, progress } = graphViewModel.getState();
    if (discovering && progress) {
      const text = `Discovering… hop ${progress.hop}/${progress.depth}, ${progress.processed} processed`;
      if (!progressToast) progressToast = showToast(text, { duration: null, variant: 'discovery' });
      else progressToast.update(text);
    } else if (progressToast) {
      progressToast.dismiss();
      progressToast = null;
      showToast('Done!', { variant: 'success' });
    }
  });

  graphViewModel.onNodeDiscovered((node) => {
    showToast(`Discovered: ${node.artist ? `${node.artist} – ` : ''}${node.title || node.label}`, { variant: 'discovery' });
  });
}
