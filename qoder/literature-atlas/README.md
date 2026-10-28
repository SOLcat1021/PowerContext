# 文脉星图 · Literature Atlas

面向 2026 OceanBase 赛题"PowerContext 生态"的参赛作品。文脉星图把阅读文献的过程组织成一张可浏览的星图：每篇论文是一个节点，节点之间的继承、分支、对照关系是边。项目基于 `oceanbase/powercontext` 的 `2026-competition-ecosystem` 分支，网页原型位于 `qoder/literature-atlas/web-prototype`。

## 目录结构

```
qoder/literature-atlas/
├── README.md                  本文件
├── QODER_DEVELOPMENT_RECORD.md 本次 Qoder 开发复核记录
└── web-prototype/             Vite 前端 + Node 本机服务
    ├── src/                   前端源码（Three.js 星图、文献模型、问答、PowerContext 客户端）
    ├── server/                本机 Node 服务（local-ai.mjs、powercontext.mjs）
    ├── scripts/               构建与验证脚本
    ├── public/                静态资源（CV 示例截图）
    ├── .env.example           环境变量示例
    ├── AI_SETUP.md            可选 AI 模型接入说明
    └── POWERCONTEXT_SETUP.md  PowerContext 本机接入说明
```

## 运行步骤

### 1. 前置条件

- Node.js 20+
- Python 3.11+ 与 `uv`（用于运行 PowerContext Server）
- 浏览器（Chrome / Edge / Firefox 均可）

### 2. 启动 PowerContext Server（可选，但推荐）

PowerContext 提供 Source 写入、Memory 持久化与全文检索。**不启动 PowerContext 时，网站仍可手动导入 PDF 并使用本地检索**。浏览器 IndexedDB 会在本地保存文献数据，即使不启动 PowerContext 也能跨会话保留已导入的论文与关系。

```powershell
# Windows 上建议显式选择 Python 3.12
uv tool install --python 3.12 "powercontext[cli,server]==1.2.0"
& "$HOME\.local\bin\powercontext.exe" server run --host 127.0.0.1 --port 8017
```

### 3. 安装依赖并构建

```bash
cd qoder/literature-atlas/web-prototype
npm ci
npm run build
```

### 4. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

- `POWERCONTEXT_URL=http://127.0.0.1:8017` — 指向本机 PowerContext Server
- `VITE_POWERCONTEXT_ENDPOINT=/api/context` — 前端调用本机服务的路径前缀
- 如需使用已有 Scope，填写 `POWERCONTEXT_SCOPE_ID`；留空则按幂等键自动创建
- 如 PowerContext Server 开启鉴权，填写 `POWERCONTEXT_TOKEN`（不要加 `VITE_` 前缀，不要提交到 Git）
- **可选**：如需启用 AI 综合回答，取消注释 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY` 与两个 `VITE_LITERATURE_*_ENDPOINT`。真实模型 Key 只在本机服务端读取，不进入浏览器。详见 `AI_SETUP.md`。

### 5. 启动本机服务

```bash
npm run start:local
```

服务默认监听 `http://127.0.0.1:4174`。打开浏览器访问该地址即可。

### 6. 验证服务状态

访问 `http://127.0.0.1:4174/api/health`，应看到：

```json
{ "configured": false, "model": null }
```

`configured: false` 表示未配置 AI 模型（正常，模型可选）。访问 `http://127.0.0.1:4174/api/context/health`，应看到：

```json
{ "configured": true, "connected": true, "scopeId": "scp_..." }
```

`connected: true` 表示 PowerContext Server 已连接。

## 验证样例

### 单元测试

```bash
node --test
```

预期输出：20 个测试全部通过。

- `top paper keyword prefers a specific PDF keyword supported by the title` — 测试关键词提取优先选择标题支持的 PDF 关键词
- `paper title provides a useful fallback when the PDF has no keyword list` — 测试无关键词时回退到标题
- `CV example answers a relationship question from connected papers with traceable sources` — 测试 CV 示例库能回答论文关系问题并返回可追溯来源
- `unmatched questions do not invent outside-library answers` — 测试库外问题不会伪造答案
- `PowerContext citation object supplies its entry ID for display` — 测试将真实 API 返回的 citation 对象提取成可阅读的 Memory entry ID
- `sources carry PowerContext citation when citationsById maps the node` — 测试 PowerContext 检索命中后，依据论文携带对应的 Memory citation
- `sources omit citation field when citationsById is absent or empty` — 测试未连接 PowerContext 时，依据论文不显示 citation
- `only matched nodes receive citation; unmatched sources stay citation-free` — 测试 citation 只映射到命中的论文，其他来源不受影响
- `src/node-hit-test.js` — 测试节点与边的命中检测
- `tests/camera-transition.test.js` — 4 个相机过渡测试
- `tests/local-ai-server.test.mjs` — 本机 AI 服务集成测试
- `tests/media-picker-state.test.js` — 2 个媒体选择器状态测试
- `tests/powercontext-adapter.test.js` — 2 个 PowerContext 适配器测试
- `tests/vector-scene.test.js` — 2 个向量场景测试

### PowerContext 集成验证

在保持 PowerContext Server 和本机服务运行的情况下：

```bash
npm run verify:context
```

该脚本把 9 篇 CV 示例文献同步到 PowerContext，预期输出（若此前已同步过）：

```json
{
  "connected": true,
  "scopeId": "scp_...",
  "first": { "synced": 0, "skipped": 9, "scopeId": "scp_..." },
  "second": { "synced": 0, "skipped": 9, "scopeId": "scp_..." },
  "searchMode": "fts",
  "matchedPaperIds": ["cv-resnet"]
}
```

- **首次同步**（此前从未运行过）：9 篇全部写入（`synced: 9, skipped: 0`）
- **后续运行**：9 篇全部跳过（`skipped: 9, synced: 0`），证明幂等性
- **检索**：查询 `ResNet residual learning` 返回 `cv-resnet`，证明 Memory 全文检索生效

同步状态保存在 `.local-data/powercontext-sync.json`（已被 Git 忽略）。

### 静态站点构建

```bash
npm run build:site
```

生成 `dist-site/` 目录，该目录是纯静态文件，可部署到任何静态托管服务。构建时会自动清空 `VITE_POWERCONTEXT_ENDPOINT`、`VITE_LITERATURE_ASK_ENDPOINT`、`VITE_LITERATURE_CLASSIFY_ENDPOINT`，确保静态站点不依赖本机服务。

## Source / Memory / Search 的实际作用

文脉星图通过 PowerContext 的三个核心能力实现文献持久化与检索：

### Source（文献来源写入）

当用户在前端确认一篇文献（手动导入或 PDF 提取）后，本机服务调用 PowerContext 的 `/v1/sources/content` 接口，将文献的结构化信息（ID、标题、作者、年份、DOI、标签、摘要）写入 Source。每次写入携带内容 SHA-256 哈希，用于后续去重。

**实际作用**：Source 是文献的权威记录。它保存用户确认的论文元数据，不保存 PDF 原件（PDF 留在浏览器 IndexedDB）。Source 的幂等键确保同一篇文献不会重复写入。

### Memory（文献记忆持久化）

写入 Source 后，本机服务紧接着调用 `/v1/memory/remember`，将文献信息作为 `fact` 类型存入 Memory。Memory 条目携带 `citation`（引用标识），后续更新时先 retire 旧条目再写入新条目。

**实际作用**：Memory 是 PowerContext 侧的跨会话文献记忆。用户关闭浏览器后重新打开，PowerContext 仍保留已同步的文献。本机服务在 `.local-data/powercontext-sync.json` 维护一份 ledger，记录每篇文献的哈希与 citation，用于判断是否需要更新。注意：即使不启动 PowerContext，浏览器 IndexedDB 也会跨会话保存已导入的文献数据；Memory 是 PowerContext 服务端的额外持久化层。

### Search（全文检索）

前端问答面板调用 `/api/context/search`，本机服务转发到 PowerContext 的 `/v1/memory/search`。PowerContext 使用全文检索（`fts` 模式）返回匹配的 Memory 条目，本机服务从条目文本中提取 `paperId`，映射回前端节点。

**实际作用**：Search 让问答不依赖向量嵌入或模型推理。用户提问"ResNet 的残差学习"时，PowerContext 全文匹配到 `cv-resnet` 的 Memory 条目，前端据此组织可追溯的回答。检索结果附带 `citation`，右侧问答面板的依据论文会显示对应的 PowerContext Memory citation，便于溯源。

### 三者的协作流程

```
用户确认文献
  → Source 写入（/v1/sources/content）
  → Memory 持久化（/v1/memory/remember）
  → Ledger 记录哈希与 citation

用户提问
  → Search 检索（/v1/memory/search）
  → 匹配 paperId
  → 前端组织回答并附带来源
```

## 公开站点与静态限制

### 公开站点

文脉星图可构建为纯静态站点（`npm run build:site`），部署到 Qoder Sites 或其他静态托管服务。静态站点包含：

- 完整的 Three.js 星图可视化
- CV 示例库（9 篇经典论文及关系）
- 本地文献问答（基于标题、标签、摘要的关键词匹配）
- PDF 导入与手动编辑功能

### 静态限制

**静态站点无法连接用户电脑上的 PowerContext Server**。原因：

1. PowerContext Server 默认监听 `127.0.0.1:8017`，仅本机可访问
2. 浏览器安全策略禁止公网页面访问本地回环地址
3. 静态站点构建时已清空 `VITE_POWERCONTEXT_ENDPOINT`，前端不会尝试调用本机服务

因此，公开站点不显示 PowerContext 同步按钮，问答面板使用本地检索而非 PowerContext Memory。评审如需体验完整的 PowerContext 集成，需按上述步骤在本地运行 PowerContext Server 和本机服务。

### 本机服务的限制

本机服务（`server/local-ai.mjs`）默认只监听 `127.0.0.1`，不提供公网部署或多用户密钥管理。AI 模型 API Key 只在本机服务端读取，不进入浏览器环境变量。如需公网部署，应使用反向代理（如 Nginx）并自行配置 HTTPS 与鉴权。

## 技术栈

- **前端**：Vite 6 + Three.js 0.186 + pdfjs-dist 6.4
- **后端**：Node.js 原生 HTTP 服务（无框架）
- **PowerContext**：`powercontext[cli,server]==1.2.0`
- **测试**：Node.js 内置 `node:test`

## 开发记录与来源

本项目复用原 GlimmerAxis 网页原型的 Three.js 时间轴与交互，并将应用场景改为文献脉络整理。当前参赛整理与检索引用展示由 Qoder CLI 完成，实际步骤见 [QODER_DEVELOPMENT_RECORD.md](QODER_DEVELOPMENT_RECORD.md)。PowerContext 为独立的开源依赖；本目录中的网页源码并不因放入参赛仓库而自动沿用 PowerContext 的许可证。
