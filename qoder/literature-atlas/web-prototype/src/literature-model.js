import { normalizeNode } from './memory-model.js';

export const LITERATURE_DOCUMENT_KEY = 'literature-axis-graph-v1';
export const LEGACY_ATLAS_KEY = 'literature-atlas-v1';

const genericKeywords = /^(computer vision|deep learning|machine learning|image processing|neural networks?|计算机视觉|深度学习|机器学习|图像处理|神经网络)$/i;

export function topPaperKeyword(paper = {}) {
  const explicit = String(paper.topKeyword || '').trim();
  if (explicit) return explicit;
  const title = String(paper.title || '').trim();
  const abstract = String(paper.abstract || '').trim();
  const candidates = (Array.isArray(paper.tags) ? paper.tags : []).map((item, index) => ({
    value: String(item).trim(), index,
  })).filter(({ value }) => value.length >= 2 && value.length <= 40 && !genericKeywords.test(value));
  if (candidates.length) {
    candidates.sort((a, b) => {
      const score = ({ value, index }) => (title.toLocaleLowerCase().includes(value.toLocaleLowerCase()) ? 6 : 0)
        + (abstract.toLocaleLowerCase().includes(value.toLocaleLowerCase()) ? 3 : 0)
        + Math.min(value.length, 18) / 20 - index * .01;
      return score(b) - score(a);
    });
    return candidates[0].value;
  }
  if (!title) return '文献主题';
  const prefix = title.split(/[:：]|\b(?:for|with|using|via|towards|from|in|of)\b/i)[0].trim();
  const words = prefix.replace(/^(?:a|an|the)\s+/i, '').split(/\s+/).filter(Boolean);
  return (words.length > 4 ? words.slice(0, 4).join(' ') : prefix).slice(0, 32) || title.slice(0, 32);
}

export function paperToNode(paper, index = 0) {
  const year = Math.max(1000, Math.min(2100, Number(paper.year) || new Date().getFullYear()));
  const date = `${year}-01-01`;
  const abstract = String(paper.abstract || paper.text || '').trim();
  return normalizeNode({
    id: paper.id || `paper-${crypto.randomUUID()}`,
    date,
    title: String(paper.title || '未命名文献').trim(),
    type: paper.type === 'milestone' ? 'milestone' : 'memory',
    createdAt: paper.addedAt || new Date().toISOString(),
    x: (index % 2 ? 1 : -1) * (0.9 + (index % 3) * 0.17),
    z: ((index % 5) - 2) * 0.2,
    text: abstract,
    entries: [],
    media: [],
    paper: {
      authors: String(paper.authors || '').trim(),
      year,
      doi: String(paper.doi || '').trim(),
      tags: Array.isArray(paper.tags) ? paper.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      topKeyword: String(paper.topKeyword || '').trim(),
      abstract,
      fileName: String(paper.fileName || '').trim(),
      pdfId: String(paper.pdfId || '').trim(),
    },
  });
}

export function legacyAtlasToGraph(value) {
  if (!Array.isArray(value?.papers) || !Array.isArray(value?.edges)) return null;
  return {
    nodes: value.papers.map(paperToNode),
    links: value.edges.map((edge) => ({
      id: edge.id || crypto.randomUUID(),
      from: edge.from,
      to: edge.to,
      kind: 'branch',
      reason: String(edge.reason || '').trim(),
    })),
    mode: 'preview',
    scale: 'year',
    autoRotate: true,
    selectedId: value.selected || null,
  };
}

export function relationCandidates(nodes, links, dismissed = []) {
  const connected = new Set(links.map((link) => [link.from, link.to].sort().join('|')));
  const rejected = new Set(dismissed);
  const result = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const key = [a.id, b.id].sort().join('|');
      if (connected.has(key) || rejected.has(key)) continue;
      const aTags = a.paper?.tags || [];
      const bTags = b.paper?.tags || [];
      const shared = aTags.filter((tag) => bTags.some((other) => tag.localeCompare(other, undefined, { sensitivity: 'base' }) === 0));
      if (!shared.length) continue;
      result.push({ key, a, b, shared });
    }
  }
  return result;
}
