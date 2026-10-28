import test from 'node:test';
import assert from 'node:assert/strict';
import { createCvDemoGraph } from './cv-demo.js';
import { answerLiteratureQuestion, memoryCitationId } from './literature-qa.js';

test('PowerContext citation object supplies its entry ID for display', () => {
  assert.equal(memoryCitationId({ memory_ref: { revision: 9 }, entry_id: 'mem_ent_123', entry_version_id: 'mem_ver_456' }), 'mem_ent_123');
  assert.equal(memoryCitationId(null), null);
});

test('CV example answers a relationship question from connected papers with traceable sources', () => {
  const { nodes, links } = createCvDemoGraph();
  const result = answerLiteratureQuestion(nodes, links, 'Faster R-CNN 与 Mask R-CNN 有什么关系？');
  assert.match(result.text, /增加实例掩码分支|增加并行的掩码预测分支/);
  assert.deepEqual(result.sources.slice(0, 2).map((source) => source.id).sort(), ['cv-faster', 'cv-mask']);
  assert.ok(result.sources.every((source) => source.url.startsWith('https://')));
});

test('unmatched questions do not invent outside-library answers', () => {
  const { nodes, links } = createCvDemoGraph();
  const result = answerLiteratureQuestion(nodes, links, '量子引力波实验有什么结论？');
  assert.deepEqual(result.sources, []);
  assert.match(result.text, /没有找到足够依据/);
});

test('sources carry PowerContext citation when citationsById maps the node', () => {
  const { nodes, links } = createCvDemoGraph();
  const citationsById = new Map([['cv-resnet', 'mc_resnet_abc123'], ['cv-faster', 'mc_faster_def456']]);
  const result = answerLiteratureQuestion(nodes, links, 'ResNet 的残差学习', { fromContext: true, citationsById });
  assert.ok(result.sources.length > 0, 'should have at least one source');
  const resnetSource = result.sources.find((s) => s.id === 'cv-resnet');
  assert.ok(resnetSource, 'cv-resnet should be among sources');
  assert.equal(resnetSource.citation, 'mc_resnet_abc123');
});

test('sources omit citation field when citationsById is absent or empty', () => {
  const { nodes, links } = createCvDemoGraph();
  const without = answerLiteratureQuestion(nodes, links, 'Faster R-CNN 与 Mask R-CNN 有什么关系？');
  for (const source of without.sources) {
    assert.equal(source.citation, undefined, `${source.id} should not have citation without citationsById`);
  }
  const empty = answerLiteratureQuestion(nodes, links, 'Faster R-CNN 与 Mask R-CNN 有什么关系？', { citationsById: new Map() });
  for (const source of empty.sources) {
    assert.equal(source.citation, undefined, `${source.id} should not have citation with empty map`);
  }
});

test('only matched nodes receive citation; unmatched sources stay citation-free', () => {
  const { nodes, links } = createCvDemoGraph();
  const citationsById = new Map([['cv-resnet', 'mc_resnet_abc123']]);
  const result = answerLiteratureQuestion(nodes, links, 'Faster R-CNN 与 Mask R-CNN 有什么关系？', { citationsById });
  const fasterSource = result.sources.find((s) => s.id === 'cv-faster');
  assert.ok(fasterSource, 'cv-faster should be among sources');
  assert.equal(fasterSource.citation, undefined, 'cv-faster should not get citation since it is not in citationsById');
});
