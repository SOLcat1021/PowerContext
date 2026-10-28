import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import "./styles.css";

env.allowLocalModels = false;
env.useBrowserCache = true;

type Doc = { id: string; title: string; text: string; embedding?: number[] };
type Result = { id: string; title: string; text: string; distance?: number };

const root = document.querySelector<HTMLDivElement>("#root")!;
let extractor: FeatureExtractionPipeline | null = null;
let activeBackend = "未加载";
const docs: Doc[] = [];
const loadPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: { device: string; dtype: string },
) => Promise<FeatureExtractionPipeline>;

const appState = {
  busy: false,
  message: "准备就绪。导入文本后，向量化和查询都会在本机浏览器中完成。",
  results: [] as Result[],
  metrics: {
    modelLoad: [] as number[],
    vectorize: [] as number[],
    write: [] as number[],
    queryEmbed: [] as number[],
    seekdb: [] as number[],
    e2e: [] as number[],
  },
};

function median(values: number[]) {
  if (!values.length) return "—";
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return `${Math.round(value)} ms`;
}

function render() {
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand"><span class="mark">LR</span><div><strong>Local Recall</strong><small>StepFun / seekdb hybrid lab</small></div></div>
        <div class="status"><span class="dot ${appState.busy ? "working" : "ready"}"></span>${appState.busy ? "处理中" : "本地模式"}</div>
      </header>
      <section class="hero"><div><p class="eyebrow">端侧检索工作台</p><h1>让知识留在你的设备上。</h1><p class="lede">浏览器本地生成 embedding，seekdb 负责持久化和全文 + 向量混合检索。</p></div><div class="hero-card"><span>推理后端</span><strong>${activeBackend}</strong><small>${appState.message}</small></div></section>
      <section class="workspace">
        <aside class="panel import-panel"><div class="panel-head"><div><p class="eyebrow">01 / 导入语料</p><h2>建立你的知识库</h2></div><span class="count">${docs.length} 篇</span></div>
          <label class="dropzone" for="file-input"><span class="upload-icon">↑</span><strong>选择 .txt / .md 文件</strong><small>文本不会上传到云端，向量化在本地进行</small></label>
          <input id="file-input" type="file" accept=".txt,.md,text/plain,text/markdown" multiple />
          <div class="doc-list">${docs.length ? docs.map((doc) => `<article><span class="doc-type">TXT</span><div><strong>${escapeHtml(doc.title)}</strong><small>${doc.text.length.toLocaleString()} 字符</small></div></article>`).join("") : `<div class="empty">还没有文档。导入一份产品说明、论文或会议记录开始。</div>`}</div>
        </aside>
        <section class="panel search-panel"><div class="panel-head"><div><p class="eyebrow">02 / 混合检索</p><h2>问问你的资料</h2></div><span class="db-badge">seekdb connected</span></div>
          <form id="search-form" class="search-box"><input id="query" placeholder="例如：WebGPU 降级策略是什么？" autocomplete="off"/><button ${appState.busy ? "disabled" : ""}>搜索 <span>↗</span></button></form>
          <div class="results">${appState.results.length ? appState.results.map((r, i) => `<article class="result"><div class="result-index">0${i + 1}</div><div><div class="result-title"><strong>${escapeHtml(r.title)}</strong><span>${r.distance == null ? "hybrid" : `${(1 - r.distance).toFixed(2)} match`}</span></div><p>${escapeHtml(r.text)}</p></div></article>`).join("") : `<div class="empty large"><span class="search-glyph">⌕</span><strong>搜索结果会显示在这里</strong><small>seekdb 会在一次查询中融合关键词匹配和语义相似度</small></div>`}</div>
          <div class="metrics"><div><span>模型加载</span><strong>${median(appState.metrics.modelLoad)}</strong></div><div><span>向量化</span><strong>${median(appState.metrics.vectorize)}</strong></div><div><span>写入 / 刷新</span><strong>${median(appState.metrics.write)}</strong></div><div><span>查询向量</span><strong>${median(appState.metrics.queryEmbed)}</strong></div><div><span>seekdb 检索</span><strong>${median(appState.metrics.seekdb)}</strong></div><div><span>端到端</span><strong>${median(appState.metrics.e2e)}</strong></div></div>
        </section>
      </section>
      <footer><span>模型：Xenova/all-MiniLM-L6-v2 · INT8 / FP16 · WebGPU → WASM</span><span>local-first / no cloud inference</span></footer>
    </main>`;
  wireEvents();
}

function escapeHtml(value: string) { return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }

async function getExtractor() {
  if (extractor) return extractor;
  appState.busy = true; appState.message = "正在加载本地 embedding 模型…"; render();
  const started = performance.now();
  try {
    extractor = await loadPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "webgpu", dtype: "fp16" });
    activeBackend = "WebGPU / FP16";
  } catch {
    extractor = await loadPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "wasm", dtype: "q8" });
    activeBackend = "WASM / INT8（降级）";
  }
  appState.metrics.modelLoad.push(performance.now() - started);
  appState.busy = false; appState.message = "模型已在浏览器中加载，数据不会发送到云端。"; render();
  return extractor;
}

async function embed(text: string) {
  const model = await getExtractor();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array).slice(0, 384);
}

async function importFiles(files: FileList) {
  appState.busy = true; appState.message = `正在处理 ${files.length} 份文档…`; render();
  for (const file of Array.from(files)) {
    const text = await file.text();
    const vectorStarted = performance.now();
    const embedding = await embed(text.slice(0, 12000));
    appState.metrics.vectorize.push(performance.now() - vectorStarted);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const writeStarted = performance.now();
    const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title: file.name, text, embedding }) });
    if (!response.ok) throw new Error(await response.text());
    appState.metrics.write.push(performance.now() - writeStarted);
    docs.push({ id, title: file.name, text, embedding });
  }
  appState.busy = false; appState.message = `已写入 seekdb，可检索 ${docs.length} 篇文档。`; render();
}

async function search(query: string) {
  appState.busy = true; appState.message = "正在本地生成查询向量并调用 seekdb 混合检索…"; render();
  const e2eStarted = performance.now();
  const embedStarted = performance.now();
  const embedding = await embed(query);
  appState.metrics.queryEmbed.push(performance.now() - embedStarted);
  const retrievalStarted = performance.now();
  const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, embedding, limit: 8 }) });
  if (!response.ok) throw new Error(await response.text());
  appState.metrics.seekdb.push(performance.now() - retrievalStarted);
  const payload = await response.json() as { ids: string[]; documents: string[]; metadatas: Array<{ title?: string }>; distances: number[] };
  appState.results = payload.ids.map((id, i) => ({ id, text: payload.documents[i] ?? "", title: payload.metadatas[i]?.title ?? id, distance: payload.distances[i] }));
  appState.metrics.e2e.push(performance.now() - e2eStarted);
  appState.busy = false; appState.message = `seekdb 返回 ${appState.results.length} 条混合检索结果。`; render();
}

function wireEvents() {
  document.querySelector<HTMLInputElement>("#file-input")?.addEventListener("change", (event) => {
    const files = (event.target as HTMLInputElement).files;
    if (files?.length) importFiles(files).catch((error) => { appState.busy = false; appState.message = String(error); render(); });
  });
  document.querySelector<HTMLFormElement>("#search-form")?.addEventListener("submit", (event) => {
    event.preventDefault(); const query = document.querySelector<HTMLInputElement>("#query")?.value.trim();
    if (query) search(query).catch((error) => { appState.busy = false; appState.message = String(error); render(); });
  });
}

render();
