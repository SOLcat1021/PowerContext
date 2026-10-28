const STORE_KEY = 'shiguang-powercontext-v1';

function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY));
    return value && typeof value === 'object' ? value : { memories: [], handoffs: [] };
  } catch {
    return { memories: [], handoffs: [] };
  }
}

function writeStore(value) {
  localStorage.setItem(STORE_KEY, JSON.stringify(value));
}

function terms(query) {
  return String(query || '').toLowerCase().split(/\s+/).flatMap((part) => part.split(/[，。；、：:（）()\-_/]+/)).filter((part) => part.length > 1);
}

/**
 * A small browser adapter that follows PowerContext's memory / handoff / prepared
 * context vocabulary. It keeps the demo static-site friendly while preserving a
 * clean seam for a hosted PowerContext HTTP endpoint later.
 */
export class PowerContextBridge {
  constructor({ scope = 'shiguang-research', endpoint = '' } = {}) {
    this.scope = scope;
    this.endpoint = endpoint;
    this.backend = endpoint ? 'powercontext-http' : 'powercontext-local';
  }

  rememberMemory(memory) {
    const store = readStore();
    const item = { ...memory, scope: this.scope, updatedAt: new Date().toISOString() };
    const index = store.memories.findIndex((entry) => entry.id === item.id);
    if (index >= 0) store.memories[index] = item;
    else store.memories.unshift(item);
    writeStore(store);
    return item;
  }

  searchMemory(query, limit = 8) {
    const queryTerms = terms(query);
    return readStore().memories.filter((item) => item.scope === this.scope).map((item) => {
      const haystack = `${item.title || ''} ${item.text || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
      const score = queryTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { ...item, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  prepareContext({ query, topic, currentPaper, limit = 4 }) {
    const memories = this.searchMemory(`${query || ''} ${topic || ''}`, limit);
    return {
      scope: this.scope,
      query,
      topic,
      currentPaper: currentPaper ? { id: currentPaper.id, title: currentPaper.title } : null,
      memories,
      preparedAt: new Date().toISOString(),
    };
  }

  recordHandoff(handoff) {
    const store = readStore();
    store.handoffs.unshift({ ...handoff, scope: this.scope, createdAt: new Date().toISOString() });
    store.handoffs = store.handoffs.slice(0, 20);
    writeStore(store);
    return store.handoffs[0];
  }

  seed(items) {
    const store = readStore();
    if (store.memories.some((item) => item.scope === this.scope)) return;
    items.forEach((item) => this.rememberMemory(item));
  }
}
