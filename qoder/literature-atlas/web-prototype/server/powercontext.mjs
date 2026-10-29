import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const short = (value, max) => String(value || '').trim().slice(0, max);

export function createPowerContext(config, root) {
  const base = short(config.POWERCONTEXT_URL, 500).replace(/\/+$/, '');
  const token = config.POWERCONTEXT_TOKEN || '';
  const explicitScopeId = config.POWERCONTEXT_SCOPE_ID || '';
  const ledgerPath = path.join(root, '.local-data', 'powercontext-sync.json');
  let scopePromise;
  let ledgerPromise;
  let queue = Promise.resolve();

  function enabled() { return Boolean(base); }

  function checkedBase() {
    if (!base) throw new Error('尚未配置 POWERCONTEXT_URL');
    const url = new URL(base);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('PowerContext 远程连接必须使用 HTTPS');
    }
    return base;
  }

  async function post(endpoint, body) {
    const response = await fetch(`${checkedBase()}${endpoint}`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const requestId = response.headers.get('x-powercontext-request-id');
      throw new Error(`PowerContext ${endpoint} 返回 HTTP ${response.status}${requestId ? `（请求 ${requestId}）` : ''}`);
    }
    return response.json();
  }

  async function scopeId() {
    if (explicitScopeId) return explicitScopeId;
    scopePromise ||= post('/v1/scopes', {
      title: '文脉星图', summary: '用户确认的文献及研究脉络', idempotency_key: 'literature-axis-app-v1',
    }).then((result) => result.scope_id).catch((error) => { scopePromise = null; throw error; });
    return scopePromise;
  }

  async function ledger() {
    ledgerPromise ||= readFile(ledgerPath, 'utf8').then(JSON.parse).catch((error) => {
      if (error.code === 'ENOENT') return {};
      throw error;
    });
    return ledgerPromise;
  }

  async function saveLedger(value) {
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const temporary = `${ledgerPath}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await rename(temporary, ledgerPath);
  }

  function normalizePaper(value) {
    if (!value || typeof value !== 'object') throw new Error('文献数据无效');
    const paper = {
      id: short(value.id, 100), title: short(value.title, 300), authors: short(value.authors, 300),
      year: Number(value.year) || null, doi: short(value.doi, 300), abstract: short(value.abstract, 1800),
      tags: Array.isArray(value.tags) ? value.tags.slice(0, 12).map((tag) => short(tag, 50)).filter(Boolean) : [],
    };
    if (!/^[\w-]{1,100}$/.test(paper.id) || !paper.title) throw new Error('文献缺少有效 ID 或标题');
    return paper;
  }

  function paperText(paper) {
    return [
      `文献ID: ${paper.id}`, `标题: ${paper.title}`, `作者: ${paper.authors || '未知'}`,
      `年份: ${paper.year || '未知'}`, `主题: ${paper.tags.join('、') || '未标注'}`,
      paper.doi ? `DOI或链接: ${paper.doi}` : '',
      paper.abstract ? `摘要: ${paper.abstract}` : '',
    ].filter(Boolean).join('\n');
  }

  async function existingEntry(sid, paper, text) {
    const result = await post('/v1/memory/entries/list', { scope_id: sid });
    const entries = (result.entries || []).filter((entry) => entry.text?.startsWith(`文献ID: ${paper.id}\n`));
    return { exact: entries.find((entry) => entry.text === text), stale: entries.find((entry) => entry.text !== text) };
  }

  async function syncOne(raw, sid, state) {
    const paper = normalizePaper(raw);
    const text = paperText(paper);
    const hash = createHash('sha256').update(text).digest('hex');
    const key = `${sid}:${paper.id}`;
    let previous = state[key];
    if (!previous) {
      const found = await existingEntry(sid, paper, text);
      if (found.exact?.citation) {
        state[key] = { hash, citation: found.exact.citation };
        await saveLedger(state);
        return 'skipped';
      }
      if (found.stale?.citation) previous = { citation: found.stale.citation };
    }
    if (previous?.pendingRetire) {
      await post('/v1/memory/entries/retire', { scope_id: sid, citation: previous.pendingRetire, reason: '文献信息已更新' });
      delete previous.pendingRetire;
      await saveLedger(state);
    }
    if (previous?.hash === hash) return 'skipped';
    const sourceId = `literature-${paper.id}-${hash.slice(0, 12)}`;
    await post('/v1/sources/content', {
      scope_id: sid, source_id: sourceId, content: text,
      metadata: { origin: 'literature-axis', paper_id: paper.id, content_sha256: hash },
    });
    const saved = await post('/v1/memory/remember', {
      scope_id: sid, kind: 'fact', text, reason: '用户确认并同步的文献信息',
    });
    if (!saved.entry?.citation) {
      const found = await existingEntry(sid, paper, text);
      if (!found.exact?.citation) throw new Error('PowerContext 未返回 Memory 引用');
      state[key] = { hash, citation: found.exact.citation };
      await saveLedger(state);
      return 'skipped';
    }
    state[key] = { hash, citation: saved.entry.citation, ...(previous?.citation ? { pendingRetire: previous.citation } : {}) };
    await saveLedger(state);
    if (state[key].pendingRetire) {
      await post('/v1/memory/entries/retire', { scope_id: sid, citation: state[key].pendingRetire, reason: '文献信息已更新' });
      delete state[key].pendingRetire;
      await saveLedger(state);
    }
    return 'synced';
  }

  async function syncPapers(papers) {
    if (!Array.isArray(papers) || !papers.length || papers.length > 30) throw new Error('一次可同步 1 至 30 篇文献');
    const run = queue.then(async () => {
      const sid = await scopeId();
      const state = await ledger();
      const result = { synced: 0, skipped: 0, scopeId: sid };
      for (const paper of papers) result[await syncOne(paper, sid, state)]++;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  async function search(question, limit = 8) {
    const sid = await scopeId();
    const query = short(question, 600);
    if (!query) throw new Error('请输入检索问题');
    const result = await post('/v1/memory/search', { scope_id: sid, query, limit: Math.min(20, Math.max(1, Number(limit) || 8)) });
    return {
      scopeId: sid, mode: result.mode,
      hits: (result.hits || []).map((hit) => ({
        paperId: String(hit.text || '').match(/^文献ID: ([\w-]+)/m)?.[1] || null,
        text: short(hit.text, 2500), score: hit.score, citation: hit.citation,
      })).filter((hit) => hit.paperId),
    };
  }

  async function health() {
    if (!enabled()) return { configured: false, connected: false };
    try {
      const response = await fetch(`${checkedBase()}/health/ready`, { signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sid = await scopeId();
      return { configured: true, connected: true, scopeId: sid };
    } catch (error) { return { configured: true, connected: false, error: error.message }; }
  }

  return { enabled, health, syncPapers, search };
}
