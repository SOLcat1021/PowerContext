import assert from 'node:assert/strict';
import { createCvDemoGraph } from '../src/cv-demo.js';

const base = process.env.LITERATURE_URL || 'http://127.0.0.1:4174';
async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${value.error || response.status}`);
  return value;
}

const health = await fetch(`${base}/api/context/health`).then((response) => response.json());
assert.equal(health.connected, true, `PowerContext 未连接：${health.error || ''}`);
const graph = createCvDemoGraph();
const papers = graph.nodes.map((node) => ({
  id: node.id, title: node.title, authors: node.paper.authors, year: node.paper.year,
  doi: node.paper.doi, tags: node.paper.tags, abstract: node.paper.abstract,
}));
const first = await post('/api/context/sync', { papers });
const second = await post('/api/context/sync', { papers });
assert.equal(first.synced + first.skipped, papers.length);
assert.equal(second.skipped, papers.length);
const result = await post('/api/context/search', { question: 'ResNet residual learning', limit: 10 });
assert.ok(result.hits.some((hit) => hit.paperId === 'cv-resnet'));
console.log(JSON.stringify({ connected: health.connected, scopeId: health.scopeId, first, second, searchMode: result.mode, matchedPaperIds: result.hits.map((hit) => hit.paperId) }, null, 2));
