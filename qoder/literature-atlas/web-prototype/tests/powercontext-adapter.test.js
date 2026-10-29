import test from 'node:test';
import assert from 'node:assert/strict';
import { PowerContextBridge } from '../src/powercontext-adapter.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), clear: () => values.clear() };
}

test('PowerContext bridge prepares bounded context from remembered evidence', () => {
  globalThis.localStorage = storage();
  const context = new PowerContextBridge({ scope: 'test-topic' });
  context.rememberMemory({ id: 'm1', title: '位置敏感性', text: '长上下文的中间位置证据更难被利用', tags: ['评测'] });
  context.rememberMemory({ id: 'm2', title: '无关记录', text: '另一主题', tags: ['别的主题'] });
  const prepared = context.prepareContext({ query: '长上下文', topic: 'RAG 评测', limit: 3 });
  assert.equal(prepared.scope, 'test-topic');
  assert.equal(prepared.memories.length, 1);
  assert.equal(prepared.memories[0].id, 'm1');
});

test('PowerContext bridge records a handoff for the next research session', () => {
  globalThis.localStorage = storage();
  const context = new PowerContextBridge({ scope: 'test-topic' });
  const handoff = context.recordHandoff({ topic: 'RAG', next: '补充数据集来源' });
  assert.equal(handoff.scope, 'test-topic');
  assert.equal(handoff.next, '补充数据集来源');
});
