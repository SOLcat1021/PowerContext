export function deleteGraphSelection(nodes, links, nodeId, linkId) {
  if (linkId && links.some((link) => link.id === linkId)) {
    return { nodes, links: links.filter((link) => link.id !== linkId), deleted: 'edge' };
  }
  if (nodeId && nodes.some((node) => node.id === nodeId)) {
    return { nodes: nodes.filter((node) => node.id !== nodeId), links: links.filter((link) => link.from !== nodeId && link.to !== nodeId), deleted: 'node' };
  }
  return null;
}
