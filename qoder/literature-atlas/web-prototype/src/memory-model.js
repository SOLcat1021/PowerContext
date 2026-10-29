export const DEFAULT_COLOR = '#eef2ef';
export const COLOR_PALETTE = [DEFAULT_COLOR, '#b8d8ff', '#f4d69b', '#bed9c3', '#d3c0ec', '#efc2ca'];

export function normalizeNode(node) {
  node.media ||= [];
  for (const media of node.media) media.id ||= crypto.randomUUID();
  if (!Array.isArray(node.entries)) {
    const blocks = [];
    if (node.text) blocks.push({ id: crypto.randomUUID(), type: 'text', text: node.text });
    for (const kind of ['image', 'video']) {
      const ids = node.media.filter((media) => media.kind === kind).map((media) => media.id);
      if (ids.length) blocks.push({ id: crypto.randomUUID(), type: kind, mediaIds: ids, caption: '' });
    }
    node.entries = blocks.length ? [{ id: crypto.randomUUID(), createdAt: node.createdAt || `${node.date}T12:00:00`, updatedAt: null, blocks }] : [];
  }
  node.cover ||= { mediaId: node.media.find((media) => media.kind === 'image')?.id || null, hidden: false, x: 50, y: 50, zoom: 1 };
  return node;
}

export function syncNodeSummary(node) {
  node.text = (node.entries || []).flatMap((entry) => entry.blocks)
    .map((block) => block.type === 'text' ? block.text : block.caption || '').filter(Boolean).join('\n\n');
}

export function coverMedia(node) {
  if (node.cover?.hidden) return null;
  return node.media?.find((media) => media.id === node.cover?.mediaId) || null;
}

export function visibleColor(color) {
  if (!/^#[\da-f]{6}$/i.test(color || '')) return DEFAULT_COLOR;
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  const lift = Math.max(0, 145 - luminance);
  return `#${channels.map((channel) => Math.min(255, Math.round(channel + lift)).toString(16).padStart(2, '0')).join('')}`;
}

export function serializable(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === 'thumbnail' || key === 'missing' || key === 'blob' || key === 'thumbnailBlob') return undefined;
    if (key === 'src' && typeof item === 'string' && item.startsWith('blob:')) return undefined;
    return item;
  }));
}

export function entryHasContent(entry) {
  return entry.blocks.some((block) => block.type === 'text' ? block.text.trim() : block.mediaIds?.length);
}
