import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('本机 AI 服务使用服务端 Key 完成分类和有来源的问答', async () => {
  const requests = [];
  const provider = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    const classify = body.includes('文献节点分类器');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(classify
      ? { type: 'milestone', topKeyword: '残差学习', reason: '引入残差连接' }
      : { answer: 'ResNet 引入残差连接。[cv-resnet]', sourceIds: ['cv-resnet', 'unknown-id'] }) } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerPort = provider.address().port;
  const child = spawn(process.execPath, [path.join(root, 'server/local-ai.mjs')], {
    cwd: root, env: {
      ...process.env, AI_HOST: '127.0.0.1', AI_PORT: '0',
      AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, AI_MODEL: 'test-model', AI_API_KEY: 'test-key',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const [output] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('AI 服务提前退出'); })]);
    const serverPort = Number(String(output).match(/127\.0\.0\.1:(\d+)/)?.[1]);
    assert.ok(serverPort > 0);
    const origin = `http://127.0.0.1:${serverPort}`;
    const health = await fetch(`${origin}/api/health`).then((r) => r.json());
    assert.deepEqual(health, { configured: true, model: 'test-model' });
    assert.equal(JSON.stringify(health).includes('test-key'), false);

    const classifyResponse = await fetch(`${origin}/api/classify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Deep Residual Learning for Image Recognition', year: 2016, abstract: 'Residual connections', tags: ['ResNet'] }),
    });
    assert.equal(classifyResponse.status, 200);
    assert.deepEqual(await classifyResponse.json(), { type: 'milestone', topKeyword: '残差学习', reason: '引入残差连接' });

    const askResponse = await fetch(`${origin}/api/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'ResNet 有什么贡献？', papers: [{ id: 'cv-resnet', title: 'ResNet', year: 2016, abstract: 'Residual connections' }], links: [] }),
    });
    assert.equal(askResponse.status, 200);
    assert.deepEqual(await askResponse.json(), { answer: 'ResNet 引入残差连接。[cv-resnet]', sourceIds: ['cv-resnet'] });
    assert.equal(requests.length, 2);
    assert.ok(requests.every((item) => item.authorization === 'Bearer test-key' && item.url === '/v1/chat/completions'));
  } finally {
    child.kill();
    provider.close();
  }
});
