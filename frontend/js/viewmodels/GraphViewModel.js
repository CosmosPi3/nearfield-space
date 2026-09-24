import { createStore } from './store.js';
import { createGraphState } from '../models/GraphState.js';
import { createTrackNode, hydrateTrackNode } from '../models/Track.js';
import { mapWithConcurrency } from '../models/concurrency.js';
import { computeStandardizer, applyWeights, normalizeVector, cosineSimilarity, VECTOR_DIMENSION_WEIGHTS } from '../models/similarity.js';
import * as api from '../services/api.js';

const FEATURE_FETCH_CONCURRENCY = 3;
const SIMILARITY_TIE_EPSILON = 0.01;

export function createGraphViewModel() {
  const graphState = createGraphState();
  // graphState is the real source of truth; store fields drive re-renders/UI state.
  const store = createStore({ version: 0, discovering: false, progress: null, topSimilar: [] });
  // Guards against overlapping refreshSimilarityEdges() calls (pin/unpin/
  // discover can all trigger one) — without this, an older call that started
  // before a seed finished loading can resolve its async fetch AFTER a newer,
  // more-complete call and silently overwrite topSimilar/edges with stale,
  // partial results (last-to-finish would win instead of last-to-start).
  let similarityRefreshToken = 0;

  // Separate from the reactive `store` above (which drives this graph's own
  // UI) — the Library tab has no reason to re-render on every hover/progress
  // tick, only when a track newly lands in the backend's tracks table. Kept
  // as a plain listener set rather than folded into `store` so main.js can
  // refresh (or mark stale) the library view without this view model taking
  // any dependency on it.
  const libraryChangeListeners = new Set();
  function notifyLibraryChange() {
    for (const listener of libraryChangeListeners) listener();
  }
  function onLibraryChange(listener) {
    libraryChangeListeners.add(listener);
    return () => libraryChangeListeners.delete(listener);
  }

  function notify() {
    store.setState((s) => ({ version: s.version + 1 }));
  }

  function applyFeatureResult(id, result) {
    graphState.updateNode(id, {
      status: 'ready',
      videoId: result.videoId,
      externalLink: result.externalLink,
      source: result.source,
      vector: result.vector,
      features: result.features,
      tempoBpm: result.tempoBpm,
      rms: result.rms,
      energyValence: result.energyValence,
      viewCount: result.viewCount,
    });
  }

  function applyFeatureError(id, err) {
    graphState.updateNode(id, {
      status: err.code === 'VIDEO_UNAVAILABLE' ? 'unavailable' : 'error',
      error: err.message,
    });
  }

  function getSeedNodes() {
    return Array.from(graphState.nodes.values()).filter((n) => n.kind === 'seed');
  }

  function getReadyNodes() {
    return Array.from(graphState.nodes.values()).filter((n) => n.status === 'ready');
  }

  // Persistence is a side channel — a flaky write must never abort a pin,
  // unpin, or discovery run. Each helper swallows its own errors.
  async function persistAddNode({ id, kind, viaId = null, cosineScore = null }) {
    try {
      await api.addWorkspaceNode({ id, kind, viaId, cosineScore });
    } catch (err) {
      console.warn(`Failed to persist workspace node ${id}:`, err.message);
    }
  }

  async function persistSimilarity(id, similarity) {
    try {
      await api.setWorkspaceNodeSimilarity(id, similarity);
    } catch (err) {
      console.warn(`Failed to persist similarity for ${id}:`, err.message);
    }
  }

  // For a track that's already in the graph but hasn't been linked from
  // *this* particular parent before — an additional "Found via" relationship,
  // not the primary one (which persistAddNode+persistSimilarity already cover).
  async function persistDiscovery({ childId, parentId, similarity = null, cosineScore = null }) {
    try {
      await api.addWorkspaceDiscovery({ childId, parentId, similarity, cosineScore });
    } catch (err) {
      console.warn(`Failed to persist discovery ${parentId} -> ${childId}:`, err.message);
    }
  }

  async function persistRemoveNode(id) {
    try {
      await api.removeWorkspaceNode(id);
    } catch (err) {
      console.warn(`Failed to persist removal of ${id}:`, err.message);
    }
  }

  // Restores the persisted workspace on boot so a refresh never loses the
  // graph. Any node left `pending` (extraction was still in flight, or never
  // started, at the time it was saved) gets resolved in the background.
  async function hydrate() {
    const { nodes, links } = await api.getWorkspace();
    for (const row of nodes) graphState.addNode(hydrateTrackNode(row));
    for (const link of links) graphState.addLink(link);
    await refreshSimilarityEdges();
    notify();

    const pendingIds = nodes.filter((n) => n.status === 'pending').map((n) => n.id);
    if (pendingIds.length) {
      await mapWithConcurrency(pendingIds, FEATURE_FETCH_CONCURRENCY, (id) => loadFeaturesFor(id));
      await refreshSimilarityEdges();
      notify();
    }
  }

  // Shared by pinTrack/addTrack — only the target `kind` differs. A literal
  // "pin then immediately unpin" composition was considered instead of this
  // parameterization, but doesn't work: pinTrack awaits loadFeaturesFor to
  // completion (a real extraction can take 10-30s for a never-before-seen
  // track) before returning, so the track would sit visibly in "Pinned
  // Tracks" for that entire duration before finally being demoted. Baking
  // the target kind in from creation avoids ever entering the 'seed' state
  // for a plain add.
  async function addOrPinTrack(track, kind) {
    const exists = graphState.hasNode(track.id);
    if (exists && kind === 'discovered') return; // adding an already-known track is a no-op — never auto-demote a seed
    if (exists) {
      graphState.updateNode(track.id, { kind });
    } else {
      graphState.addNode(createTrackNode(track, { kind }));
    }
    notify();
    await persistAddNode({ id: track.id, kind });
    await loadFeaturesFor(track.id);
    if (graphState.nodes.get(track.id)?.status === 'ready') notifyLibraryChange();
    await refreshSimilarityEdges();
    notify();
  }

  // Adds a track to the graph without pinning it — search/manual-add land
  // here now; the user promotes it to a seed later via the popup's Pin button.
  function addTrack(track) {
    return addOrPinTrack(track, 'discovered');
  }

  function pinTrack(track) {
    return addOrPinTrack(track, 'seed');
  }

  // Shared by pinManualTrack/addManualTrack — see addOrPinTrack above for why
  // this is parameterized rather than composed from pin+unpin.
  async function addOrPinManualTrack(url, kind) {
    const id = `manual:${url}`;
    const exists = graphState.hasNode(id);
    if (exists && kind === 'discovered') return;
    if (exists) {
      graphState.updateNode(id, { kind });
    } else {
      graphState.addNode(createTrackNode({ id, name: url, artist: null, track: null }, { kind }));
    }
    notify();
    await persistAddNode({ id, kind });

    try {
      const result = await api.addManualTrack(url);
      graphState.updateNode(id, {
        label: `${result.artist || 'Unknown'} - ${result.track || result.name || 'Untitled'}`,
        artist: result.artist,
        title: result.track || result.name,
      });
      applyFeatureResult(id, result);
    } catch (err) {
      applyFeatureError(id, err);
    }
    notify();
    if (graphState.nodes.get(id)?.status === 'ready') notifyLibraryChange();
    await refreshSimilarityEdges();
    notify();
  }

  // Same as addTrack, for a URL not in cosine.club's catalog.
  function addManualTrack(url) {
    return addOrPinManualTrack(url, 'discovered');
  }

  // For tracks not in cosine.club's catalog — extracts directly from a
  // YouTube/Bandcamp/SoundCloud URL via our own pipeline, bypassing
  // cosine.club entirely. The resulting node has no cosine.club id, so it can
  // never be a discoverFrom seed — but is otherwise a full citizen (real
  // vector, real distances, eligible for "most similar to pinned").
  function pinManualTrack(url) {
    return addOrPinManualTrack(url, 'seed');
  }

  // "Unpin" demotes a seed back to a plain discovered node — it stays on the
  // graph with its edges intact, just no longer highlighted as a seed.
  async function unpinTrack(id) {
    graphState.updateNode(id, { kind: 'discovered' });
    notify();
    await persistAddNode({ id, kind: 'discovered' });
    await refreshSimilarityEdges();
    notify();
  }

  // Fully removes a track from the graph (not just demotes it, unlike
  // unpin) — drops its node and every link touching it, backend-analyzed
  // features/distances are untouched so re-adding it later is still instant.
  async function removeNode(id) {
    graphState.removeNode(id);
    notify();
    await persistRemoveNode(id);
    await refreshSimilarityEdges();
    notify();
  }

  async function loadFeaturesFor(id) {
    try {
      const result = await api.getFeatures(id);
      applyFeatureResult(id, result);
    } catch (err) {
      applyFeatureError(id, err);
    }
    notify();
  }

  // Draws a distance edge between every ready node pair (not just ones
  // touching a pinned seed) — this used to be seed-only, with a manual
  // "compute all distances" button as an on-demand escape hatch, but the
  // full mesh is now the standing behavior, so every pin/unpin/discover/
  // hydrate keeps it up to date automatically instead of needing a re-click.
  // As a byproduct of the same fetch, also ranks every non-seed node by its
  // average distance to ALL pinned seeds, for the "most similar to pinned"
  // list. Distances themselves are a durable fact from the backend's
  // persistent cache (computing-and-caching any gaps server-side), not
  // session-relative.
  async function refreshSimilarityEdges() {
    const token = ++similarityRefreshToken;
    graphState.removeLinksByType('similar');
    const readyNodes = getReadyNodes();
    const seedIds = new Set(getSeedNodes().filter((n) => n.status === 'ready').map((n) => n.id));
    if (readyNodes.length < 2) {
      store.setState({ topSimilar: [] });
      return;
    }

    // -1, not 0 — raw cosine similarity on standardized vectors ranges over
    // [-1,1], so a threshold of 0 would silently drop every negative
    // (actively-dissimilar, not just "unrelated") pair from the average.
    const { pairs } = await api.getBatchDistances(readyNodes.map((n) => n.id), -1);
    // A newer call has since started (e.g. another seed finished loading) —
    // its result supersedes this one. Bail before applying anything, so a
    // stale call never partially overwrites a fresher, more-complete result.
    if (token !== similarityRefreshToken) return;

    const scoresByNode = new Map();
    for (const { trackAId, trackBId, cosineScore } of pairs) {
      // A discovered-via edge between this exact pair already shows a
      // distance number — rather than draw a second overlapping edge, keep
      // that one but refresh its value to the current global score. It was
      // originally set from a live, locally-standardized score at discovery
      // time; leaving it stale would show a different number than what this
      // same fetch uses for the "most similar to pinned" ranking below.
      if (graphState.hasLinkBetween(trackAId, trackBId, 'discovered-via')) {
        graphState.updateLinkSimilarity(trackAId, trackBId, 'discovered-via', cosineScore);
      } else {
        graphState.addLink({ source: trackAId, target: trackBId, type: 'similar', similarity: cosineScore });
      }
      if (seedIds.has(trackAId) && !seedIds.has(trackBId)) {
        if (!scoresByNode.has(trackBId)) scoresByNode.set(trackBId, []);
        scoresByNode.get(trackBId).push(cosineScore);
      }
      if (seedIds.has(trackBId) && !seedIds.has(trackAId)) {
        if (!scoresByNode.has(trackAId)) scoresByNode.set(trackAId, []);
        scoresByNode.get(trackAId).push(cosineScore);
      }
    }

    const topSimilar = Array.from(scoresByNode.entries())
      .map(([id, scores]) => ({
        node: graphState.nodes.get(id),
        avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    store.setState({ topSimilar });
  }

  // Popularity nudge shared by both discovery paths below — a cheap, honest
  // tie-break using data we already have, not a hard popularity filter.
  function sortByScoreThenPopularity(items, getScore, getViewCount) {
    items.sort((a, b) => {
      const scoreA = getScore(a);
      const scoreB = getScore(b);
      if (Math.abs(scoreA - scoreB) < SIMILARITY_TIE_EPSILON) {
        return (getViewCount(a) ?? Infinity) - (getViewCount(b) ?? Infinity);
      }
      return scoreB - scoreA;
    });
    return items;
  }

  // Greedy best-first tree search from a single clicked node. Two candidate
  // sources depending on whether the seed has a cosine.club id:
  //  - cosine.club-backed seed: fetch candidates from cosine.club's /similar
  //    (a foreign embedding-based ranking), then re-score them ourselves by
  //    cosine similarity to the seed's texture vector (standardized against
  //    everything currently loaded — a live, run-scoped decision, not the
  //    persistent distance cache).
  //  - manual seed (no cosine.club id, nothing to ask "/similar" about):
  //    rank against every track ever analyzed in our own cache instead
  //    (`/tracks/:id/nearest`). Already scored on our own texture metric, so
  //    there's no separate re-ranking step for this path.
  // Either way: walks past already-visited candidates so a duplicate doesn't
  // just shrink the pool, tie-breaks near-equal scores toward lower
  // view_count, and keeps the top-half as next hop's frontier.
  async function discoverFrom(seedId, { depth, branching }) {
    if (store.getState().discovering) return;
    const seedNode = graphState.nodes.get(seedId);
    if (!seedNode || seedNode.status !== 'ready') return;
    const isManualSeed = seedId.startsWith('manual:');

    store.setState({ discovering: true, progress: { processed: 0, hop: 0, depth, estimatedTotal: 0 } });

    const expandWidth = Math.max(1, Math.ceil(branching / 2));
    let frontier = [seedId];
    const visited = new Set(graphState.nodes.keys());
    let processedCount = 0;

    try {
      for (let hop = 1; hop <= depth; hop++) {
        store.setState((s) => ({ progress: { ...s.progress, hop, estimatedTotal: s.progress.estimatedTotal + frontier.length * branching } }));
        const hopCandidateIds = [];
        // Already-visited candidates that aren't yet linked *from this
        // particular frontier node* — an additional "Found via" parent for a
        // track discovered independently elsewhere. Capped at `branching`
        // too (same budget as new discoveries) so one Discover click can't
        // relink an entire dense cluster at once. Never grows the frontier.
        const hopExtraLinks = [];

        for (const nodeId of frontier) {
          if (isManualSeed) {
            let nearestResult;
            try {
              nearestResult = await api.getNearestTracks(nodeId, branching * 3);
            } catch {
              continue; // upstream error on this node — skip it, don't abort the run
            }

            const newOnes = [];
            const extraLinks = [];
            for (const neighbor of nearestResult.neighbors) {
              if (visited.has(neighbor.id)) {
                if (neighbor.id !== nodeId && extraLinks.length < branching && !graphState.hasLinkBetween(nodeId, neighbor.id, 'discovered-via')) {
                  extraLinks.push(neighbor);
                }
                continue;
              }
              if (newOnes.length >= branching) break;
              visited.add(neighbor.id);
              newOnes.push(neighbor);
            }

            await mapWithConcurrency(newOnes, FEATURE_FETCH_CONCURRENCY, async (neighbor) => {
              try {
                // Guaranteed already extraction_status='ok' by construction
                // (drawn from the same "every analyzed track" pool) — this
                // is always a cache hit, never a fresh yt-dlp run.
                const result = await api.getFeatures(neighbor.id);
                graphState.addNode(hydrateTrackNode({ ...result, kind: 'discovered', status: 'ready', viaId: nodeId }));
                notify();
                await persistAddNode({ id: neighbor.id, kind: 'discovered', viaId: nodeId, cosineScore: null });
                graphState.addLink({ source: nodeId, target: neighbor.id, type: 'discovered-via', similarity: neighbor.cosineScore, cosineScore: null });
                await persistSimilarity(neighbor.id, neighbor.cosineScore);
                hopCandidateIds.push({ id: neighbor.id, viaId: nodeId, score: neighbor.cosineScore, viewCount: neighbor.viewCount });
              } catch {
                // Shouldn't normally happen (candidate is already 'ok' by
                // construction) but stay defensive rather than abort the run.
              } finally {
                processedCount += 1;
                store.setState((s) => ({ progress: { ...s.progress, processed: processedCount } }));
                notify();
              }
            });
            if (newOnes.length > 0) notifyLibraryChange();

            // Already our own distance-service score — no re-standardization
            // needed, unlike the cosine.club-backed branch below.
            for (const neighbor of extraLinks) {
              graphState.addLink({ source: nodeId, target: neighbor.id, type: 'discovered-via', similarity: neighbor.cosineScore, cosineScore: null });
              await persistDiscovery({ childId: neighbor.id, parentId: nodeId, similarity: neighbor.cosineScore, cosineScore: null });
            }
            if (extraLinks.length > 0) notify();
            continue;
          }

          let similarResult;
          try {
            similarResult = await api.getSimilar(nodeId, branching * 3);
          } catch {
            continue; // upstream error on this node — skip it, don't abort the run
          }

          const newOnes = [];
          const extrasForThisNode = [];
          for (const candidate of similarResult.similarTracks) {
            if (visited.has(candidate.id)) {
              if (candidate.id !== nodeId && extrasForThisNode.length < branching && !graphState.hasLinkBetween(nodeId, candidate.id, 'discovered-via')) {
                extrasForThisNode.push(candidate);
              }
              continue;
            }
            if (newOnes.length >= branching) break;
            visited.add(candidate.id); // reserve immediately — prevents sibling
                                        // frontier nodes in this hop re-picking it
            newOnes.push(candidate);
          }
          hopExtraLinks.push(...extrasForThisNode.map((c) => ({ id: c.id, viaId: nodeId, cosineScore: c.score ?? null })));

          await mapWithConcurrency(newOnes, FEATURE_FETCH_CONCURRENCY, async (candidate) => {
            graphState.addNode(createTrackNode(candidate, { kind: 'discovered', viaId: nodeId }));
            notify();
            await persistAddNode({ id: candidate.id, kind: 'discovered', viaId: nodeId, cosineScore: candidate.score ?? null });
            try {
              const result = await api.getFeatures(candidate.id);
              applyFeatureResult(candidate.id, result);
              hopCandidateIds.push({ id: candidate.id, viaId: nodeId });
            } catch (err) {
              applyFeatureError(candidate.id, err);
            } finally {
              processedCount += 1;
              store.setState((s) => ({ progress: { ...s.progress, processed: processedCount } }));
              notify();
            }
          });
          if (newOnes.length > 0) notifyLibraryChange();
        }

        // Score and persist this hop's extra (multi-parent) relationships —
        // independent of the dead-end/next-frontier logic below, since these
        // never grow the frontier either way. Only the cosine.club-backed
        // branch needs this: the manual-seed branch already handled its own
        // extraLinks inline above (its score is already ours, no re-scoring
        // needed).
        if (hopExtraLinks.length > 0) {
          const readyNodes = getReadyNodes();
          const standardizer = computeStandardizer(readyNodes.map((n) => n.vector));
          const standardizedSeed = normalizeVector(applyWeights(standardizer.standardize(seedNode.vector), VECTOR_DIMENSION_WEIGHTS));
          for (const { id, viaId, cosineScore } of hopExtraLinks) {
            const node = graphState.nodes.get(id);
            if (!node?.vector) continue; // not ready yet — skip scoring this one, not the whole hop
            const stdVec = normalizeVector(applyWeights(standardizer.standardize(node.vector), VECTOR_DIMENSION_WEIGHTS));
            const score = cosineSimilarity(stdVec, standardizedSeed);
            graphState.addLink({ source: viaId, target: id, type: 'discovered-via', similarity: score, cosineScore });
            await persistDiscovery({ childId: id, parentId: viaId, similarity: score, cosineScore });
          }
          notify();
        }

        if (hopCandidateIds.length === 0) break; // dead end

        let nextFrontierCandidates;
        if (isManualSeed) {
          // Already scored on our own texture metric and edged above — no
          // separate re-ranking step needed for this path.
          nextFrontierCandidates = hopCandidateIds;
        } else {
          // Score by cosine similarity to the seed, standardized across everything ready.
          const readyNodes = getReadyNodes();
          const standardizer = computeStandardizer(readyNodes.map((n) => n.vector));
          const standardizedSeed = normalizeVector(applyWeights(standardizer.standardize(seedNode.vector), VECTOR_DIMENSION_WEIGHTS));

          const scored = hopCandidateIds.map(({ id, viaId }) => {
            const node = graphState.nodes.get(id);
            const stdVec = normalizeVector(applyWeights(standardizer.standardize(node.vector), VECTOR_DIMENSION_WEIGHTS));
            return { id, viaId, score: cosineSimilarity(stdVec, standardizedSeed) };
          });

          for (const { id, viaId, score } of scored) {
            graphState.addLink({ source: viaId, target: id, type: 'discovered-via', similarity: score, cosineScore: graphState.nodes.get(id)?.cosineScore ?? null });
            await persistSimilarity(id, score);
          }
          nextFrontierCandidates = scored;
        }

        sortByScoreThenPopularity(
          nextFrontierCandidates,
          (c) => c.score,
          (c) => graphState.nodes.get(c.id).viewCount
        );

        frontier = nextFrontierCandidates.slice(0, expandWidth).map((c) => c.id);
        notify();
        if (frontier.length === 0) break;
      }
    } finally {
      await refreshSimilarityEdges();
      store.setState({ discovering: false, progress: null });
      notify();
    }
  }

  function getGraphData() {
    return graphState.toForceGraphData();
  }

  // Clears the workspace graph only — the backend's distances and tracks
  // feature caches are untouched, so every score/vector ever computed stays
  // reusable for future exploration.
  async function resetGraph() {
    await api.clearWorkspace();
    graphState.clear();
    store.setState({ topSimilar: [] });
    notify();
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    onLibraryChange,
    hydrate,
    addTrack,
    addManualTrack,
    pinTrack,
    pinManualTrack,
    unpinTrack,
    removeNode,
    loadFeaturesFor,
    discoverFrom,
    resetGraph,
    getSeedNodes,
    getGraphData,
    graphState,
  };
}
