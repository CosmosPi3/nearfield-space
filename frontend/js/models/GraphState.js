// Force-Graph mutates link objects in place after rendering, replacing
// source/target from plain string ids with direct node-object references (for
// its own simulation performance). Since links here are the exact same
// object references Force-Graph receives (not copies), comparisons against a
// link's source/target must handle both forms.
function linkEndpointId(endpoint) {
  return typeof endpoint === 'object' && endpoint !== null ? endpoint.id : endpoint;
}

// Pure state container for graph nodes/links — no DOM/API knowledge.
export function createGraphState() {
  const nodes = new Map();
  const links = [];

  function addNode(node) {
    nodes.set(node.id, node);
  }

  function updateNode(id, patch) {
    const existing = nodes.get(id);
    if (!existing) return;
    // Mutate in place rather than replacing the object — Force-Graph resolves
    // link source/target into direct references to this exact object once
    // rendered (and attaches x/y/vx/vy physics state to it). Swapping in a
    // new object here would silently detach existing links/physics from the
    // node just updated.
    Object.assign(existing, patch);
  }

  function removeNode(id) {
    nodes.delete(id);
    for (let i = links.length - 1; i >= 0; i--) {
      if (linkEndpointId(links[i].source) === id || linkEndpointId(links[i].target) === id) links.splice(i, 1);
    }
  }

  function hasNode(id) {
    return nodes.has(id);
  }

  function addLink(link) {
    const exists = links.some((l) =>
      linkEndpointId(l.source) === linkEndpointId(link.source) &&
      linkEndpointId(l.target) === linkEndpointId(link.target) &&
      l.type === link.type
    );
    if (!exists) links.push(link);
  }

  function findLinkBetween(idA, idB, type) {
    return links.find((l) => {
      if (l.type !== type) return false;
      const s = linkEndpointId(l.source);
      const t = linkEndpointId(l.target);
      return (s === idA && t === idB) || (s === idB && t === idA);
    });
  }

  function hasLinkBetween(idA, idB, type) {
    return !!findLinkBetween(idA, idB, type);
  }

  // 0-N by design — a node can have several parents and several children of
  // the same link type. Returns normalized ids (not raw link objects), so
  // callers never need to know about Force-Graph's string-vs-object dance.
  function parentsOf(id, type) {
    return links
      .filter((l) => l.type === type && linkEndpointId(l.target) === id)
      .map((l) => ({ parentId: linkEndpointId(l.source), similarity: l.similarity, cosineScore: l.cosineScore ?? null }));
  }

  function childrenOf(id, type) {
    return links
      .filter((l) => l.type === type && linkEndpointId(l.source) === id)
      .map((l) => ({ childId: linkEndpointId(l.target), similarity: l.similarity, cosineScore: l.cosineScore ?? null }));
  }

  // Mutates in place (not a remove+re-add) so Force-Graph's already-resolved
  // source/target object references on this exact link object stay intact.
  function updateLinkSimilarity(idA, idB, type, similarity) {
    const link = findLinkBetween(idA, idB, type);
    if (link) link.similarity = similarity;
  }

  function removeLinksByType(type) {
    for (let i = links.length - 1; i >= 0; i--) {
      if (links[i].type === type) links.splice(i, 1);
    }
  }

  function clear() {
    nodes.clear();
    links.length = 0;
  }

  function toForceGraphData() {
    return { nodes: Array.from(nodes.values()), links: links.slice() };
  }

  return { nodes, links, addNode, updateNode, removeNode, hasNode, addLink, hasLinkBetween, parentsOf, childrenOf, updateLinkSimilarity, removeLinksByType, clear, toForceGraphData };
}
