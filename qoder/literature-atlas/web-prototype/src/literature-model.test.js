import test from 'node:test';
import assert from 'node:assert/strict';
import { topPaperKeyword } from './literature-model.js';

test('top paper keyword prefers a specific PDF keyword supported by the title', () => {
  const keyword = topPaperKeyword({
    title: 'Region Proposal Networks for Object Detection',
    abstract: 'Region proposal networks improve the detector.',
    tags: ['Computer Vision', 'Object Detection', 'Region Proposal Networks'],
  });
  assert.equal(keyword, 'Region Proposal Networks');
});

test('paper title provides a useful fallback when the PDF has no keyword list', () => {
  assert.equal(topPaperKeyword({ title: 'Deep Residual Learning for Image Recognition', tags: [] }), 'Deep Residual Learning');
});
