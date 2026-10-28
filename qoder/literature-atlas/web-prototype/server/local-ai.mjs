import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPowerContext } from './powercontext.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

async function readLocalConfig() {
  const config = { ...process.env };
  try {
    const lines = (await readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Z][A-Z\d_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      config[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return config;
}

const config = await readLocalConfig();
const host = config.AI_HOST || '127.0.0.1';
const port = Number(config.AI_PORT || 4174);
const apiKey = config.AI_API_KEY || '';
const model = config.AI_MODEL || '';
const baseUrl = config.AI_BASE_URL || '';
const context = createPowerContext(config, root);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function bodyJson(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 96_000) throw Object.assign(new Error('请求太大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求不是有效 JSON'), { status: 400 }); }
}

function completionUrl() {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('AI_BASE_URL 必须使用 HTTPS，或指向本机服务');
  }
  return new URL('chat/completions', url);
}

function parseModelJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); }
  catch { throw new Error('模型没有返回可解析的 JSON'); }
}

async function complete(system, user) {
  if (!apiKey || !model || !baseUrl) throw Object.assign(new Error('请先在 .env.local 配置 AI_API_KEY、AI_MODEL 和 AI_BASE_URL'), { status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(completionUrl(), {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, messages: [
        { role: 'system', content: system }, { role: 'user', content: user },
      ] }),
    });
    if (!response.ok) throw Object.assign(new Error(`模型服务返回 HTTP ${response.status}`), { status: 502 });
    const payload = await response.json();
    return parseModelJson(payload.choices?.[0]?.message?.content);
  } finally { clearTimeout(timer); }
}

function short(value, limit) { return String(value || '').trim().slice(0, limit); }

async function ask(request, response) {
  const input = await bodyJson(request);
  const question = short(input.question, 600);
  const papers = Array.isArray(input.papers) ? input.papers.slice(0, 30).map((paper) => ({
    id: short(paper.id, 100), title: short(paper.title, 300), year: short(paper.year, 4),
    tags: Array.isArray(paper.tags) ? paper.tags.slice(0, 10).map((tag) => short(tag, 50)) : [],
    abstract: short(paper.abstract, 1200),
  })) : [];
  const links = Array.isArray(input.links) ? input.links.slice(0, 60).map((link) => ({
    from: short(link.from, 100), to: short(link.to, 100), reason: short(link.reason, 300),
  })) : [];
  if (!question || !papers.length) return json(response, 400, { error: '需要问题和文献' });
  const result = await complete(
    '你是文献库问答助手。只能依据用户提供的论文资料与已确认的关系回答；不确定时明确说证据不足。返回 JSON 对象，字段为 answer（中文回答）和 sourceIds（依据论文 ID 数组）。回答中不要伪造论文、年份或引用。',
    JSON.stringify({ question, papers, links }),
  );
  const allowed = new Set(papers.map((paper) => paper.id));
  const sourceIds = Array.isArray(result.sourceIds) ? [...new Set(result.sourceIds.filter((id) => allowed.has(id)))].slice(0, 10) : [];
  const answer = short(result.answer, 6000);
  if (!answer || !sourceIds.length) throw new Error('模型回答缺少有效文献依据');
  json(response, 200, { answer, sourceIds });
}

async function classify(request, response) {
  const input = await bodyJson(request);
  const paper = {
    title: short(input.title, 300), year: short(input.year, 4),
    abstract: short(input.abstract, 1500),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 10).map((tag) => short(tag, 50)) : [],
  };
  if (!paper.title) return json(response, 400, { error: '需要论文标题' });
  const result = await complete(
    '你是研究文献节点分类器。依据提供的论文标题、摘要、关键词，把节点判为 milestone（有明确开创性、影响力证据的领域里程碑）或 memory（普通论文）；证据不足时选 memory。提取一个准确、简短的中文或英文核心关键词。返回 JSON 对象，字段 type、topKeyword、reason。不要用库外臆测来评里程碑。',
    JSON.stringify(paper),
  );
  json(response, 200, {
    type: result.type === 'milestone' ? 'milestone' : 'memory',
    topKeyword: short(result.topKeyword, 40), reason: short(result.reason, 300),
  });
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function staticFile(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(dist, name);
  if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) return json(response, 403, { error: '拒绝访问' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('不是文件');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { json(response, 404, { error: '文件不存在，请先运行 npm run build' }); }
}

http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { configured: Boolean(apiKey && model && baseUrl), model: model || null });
    if (request.method === 'GET' && pathname === '/api/context/health') return json(response, 200, await context.health());
    if (request.method === 'POST' && pathname === '/api/context/sync') {
      if (!context.enabled()) return json(response, 503, { error: '尚未配置 POWERCONTEXT_URL' });
      const input = await bodyJson(request);
      return json(response, 200, await context.syncPapers(input.papers));
    }
    if (request.method === 'POST' && pathname === '/api/context/search') {
      if (!context.enabled()) return json(response, 503, { error: '尚未配置 POWERCONTEXT_URL' });
      const input = await bodyJson(request);
      return json(response, 200, await context.search(input.question, input.limit));
    }
    if (request.method === 'POST' && pathname === '/api/ask') return await ask(request, response);
    if (request.method === 'POST' && pathname === '/api/classify') return await classify(request, response);
    if (request.method === 'GET' || request.method === 'HEAD') return await staticFile(request, response);
    json(response, 405, { error: '不支持的方法' });
  } catch (error) {
    json(response, Number(error.status) || 502, { error: error.message || '请求失败' });
  }
}).listen(port, host, function onListen() {
  console.log(`文脉星图本地服务：http://${host}:${this.address().port} · PowerContext ${context.enabled() ? '已配置' : '待配置'} · AI ${apiKey && model && baseUrl ? '已配置' : '可选'}`);
});
