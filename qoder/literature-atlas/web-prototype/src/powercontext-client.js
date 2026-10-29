const endpoint = import.meta.env?.VITE_POWERCONTEXT_ENDPOINT?.replace(/\/+$/, '');

export function powerContextAvailable() { return Boolean(endpoint); }

async function request(path, body) {
  if (!endpoint) throw new Error('尚未配置 PowerContext 本机服务');
  const response = await fetch(`${endpoint}${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

export function powerContextHealth() { return request('/health'); }

export function syncPowerContext(papers) {
  return request('/sync', { papers: papers.map((node) => ({
    id: node.id, title: node.title, authors: node.paper?.authors || '',
    year: node.paper?.year || Number(node.date?.slice(0, 4)),
    doi: node.paper?.doi || '', tags: node.paper?.tags || [], abstract: node.paper?.abstract || node.text || '',
  })) });
}

export function searchPowerContext(question, limit = 8) { return request('/search', { question, limit }); }
