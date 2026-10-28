import { powerContextAvailable, searchPowerContext } from './powercontext-client.js';

const aliases = {
  'cv-alexnet': ['alexnet'], 'cv-vgg': ['vgg'], 'cv-faster': ['faster r-cnn', 'faster rcnn', '区域建议'],
  'cv-unet': ['u-net', 'unet', '医学'], 'cv-resnet': ['resnet', '残差'],
  'cv-mask': ['mask r-cnn', 'mask rcnn', '实例分割'], 'cv-vit': ['vit', 'vision transformer', 'transformer'],
  'cv-clip': ['clip', '视觉语言', '语言监督'], 'cv-sam': ['sam', 'segment anything', '提示式'],
};

export function memoryCitationId(citation) {
  return typeof citation?.entry_id === 'string' ? citation.entry_id : null;
}

function terms(value) {
  return String(value).toLocaleLowerCase().match(/[a-z][a-z\d-]*|[\u3400-\u9fff]{2,}/g) || [];
}

function scorePaper(node, question) {
  const query = question.toLocaleLowerCase();
  const title = node.title.toLocaleLowerCase();
  const paper = node.paper || {};
  let score = (aliases[node.id] || []).some((alias) => query.includes(alias)) ? 12 : 0;
  if (title.length > 3 && query.includes(title)) score += 14;
  for (const word of terms(question)) {
    if (word.length < 2) continue;
    if (title.includes(word)) score += 4;
    if ((paper.tags || []).some((tag) => tag.toLocaleLowerCase().includes(word) || word.includes(tag.toLocaleLowerCase()))) score += 3;
    if (String(paper.abstract || '').toLocaleLowerCase().includes(word)) score += 1;
  }
  return score;
}

export function answerLiteratureQuestion(nodes, links, question, { fromContext = false, citationsById = null } = {}) {
  const query = String(question || '').trim();
  if (!query) return { text: '请输入一个关于文献库的问题。', sources: [] };
  if (!nodes.length) return { text: '当前文献库为空。先上传 PDF，或切换到 CV 示例库查看问答效果。', sources: [] };
  const ranked = nodes.map((node) => ({ node, score: scorePaper(node, query) })).sort((a, b) => b.score - a.score || Number(a.node.paper?.year || 0) - Number(b.node.paper?.year || 0));
  const broad = /脉络|发展|演进|路线|时间线|经典|有哪些|整个|概览/.test(query);
  const matched = broad ? ranked.slice(0, Math.min(10, nodes.length)) : fromContext ? ranked.slice(0, 3) : ranked.filter((item) => item.score > 0).slice(0, 3);
  if (!matched.length) return {
    text: '库内文献的标题、标签和摘要没有找到足够依据。可以换用论文名称、方法或任务关键词提问；我不会用库外知识补齐答案。', sources: [],
  };
  const selected = broad ? [...matched].sort((a, b) => Number(a.node.paper?.year || 0) - Number(b.node.paper?.year || 0)) : matched;
  const ids = new Set(selected.map(({ node }) => node.id));
  const lines = selected.map(({ node }, index) => `${index + 1}. ${node.paper?.year || node.date.slice(0, 4)} 年《${node.title}》：${node.paper?.abstract || node.text || '库内尚无摘要。'}`);
  const relevantLinks = links.filter((link) => ids.has(link.from) && ids.has(link.to) && link.reason).slice(0, 7);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (relevantLinks.length) {
    lines.push('关系脉络：');
    for (const link of relevantLinks) {
      lines.push(`• ${byId.get(link.from)?.title || '前一篇'} → ${byId.get(link.to)?.title || '后一篇'}：${link.reason}`);
    }
  }
  return {
    text: lines.join('\n'),
    sources: selected.map(({ node }) => {
      const source = { id: node.id, title: node.title, year: node.paper?.year || node.date.slice(0, 4), url: node.paper?.doi || '' };
      if (citationsById?.has(node.id)) source.citation = citationsById.get(node.id);
      return source;
    }),
  };
}

// A site backend can provide model synthesis without exposing an API key in the browser.
// The local answer remains available when the endpoint has not been configured.
export async function askLiterature(nodes, links, question) {
  const endpoint = import.meta.env.VITE_LITERATURE_ASK_ENDPOINT;
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, papers: nodes.map((node) => ({
          id: node.id, title: node.title, authors: node.paper?.authors || '', year: node.paper?.year || node.date.slice(0, 4),
          tags: node.paper?.tags || [], abstract: node.paper?.abstract || '', source: node.paper?.doi || '',
        })), links: links.map((link) => ({ from: link.from, to: link.to, reason: link.reason || '' })) }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const known = new Map(nodes.map((node) => [node.id, node]));
      const sources = (result.sourceIds || []).filter((id) => known.has(id)).map((id) => {
        const node = known.get(id);
        return { id, title: node.title, year: node.paper?.year, url: node.paper?.doi || '' };
      });
      if (typeof result.answer === 'string' && result.answer.trim() && sources.length) return { text: result.answer.trim(), sources, model: true };
    } catch { /* Continue with transparent local library synthesis. */ }
  }
  if (powerContextAvailable()) {
    try {
      const result = await searchPowerContext(question, 10);
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const citationsById = new Map();
      for (const hit of result.hits) {
        const citationId = memoryCitationId(hit.citation);
        if (hit.paperId && citationId) citationsById.set(hit.paperId, citationId);
      }
      const selected = result.hits.map((hit) => byId.get(hit.paperId)).filter(Boolean);
      if (selected.length) {
        const selectedIds = new Set(selected.map((node) => node.id));
        const answer = answerLiteratureQuestion(selected, links.filter((link) => selectedIds.has(link.from) && selectedIds.has(link.to)), question, { fromContext: true, citationsById });
        if (answer.sources.length) return { ...answer, model: false, context: true };
      }
    } catch { /* Local search remains usable when PowerContext is offline. */ }
  }
  return { ...answerLiteratureQuestion(nodes, links, question), model: false, context: false };
}
