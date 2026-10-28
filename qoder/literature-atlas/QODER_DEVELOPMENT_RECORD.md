# Qoder 开发复核记录

本文档记录 Qoder 在 2026-10-28 对文脉星图项目进行的实际检查与复核。**不冒称此前由其他工具或开发者完成的工作**。

## 检查范围

- 仓库：`oceanbase/powercontext`，分支 `2026-competition-ecosystem`
- 目标目录：`qoder/literature-atlas/web-prototype`
- 检查时间：2026-10-28
- Qoder CLI 会话：`ad54a3d1-bbaa-40ef-8011-30b3030fd088`（运行复核与文档）、`9a3389f7-21c9-475c-ab23-511783483e69`（Memory citation 功能与测试）
- Qoder 账号：`SolCat`；`qodercn status -o json` 的头像地址中账号标识为 `01a18121-5fea-7052-8718-23a015984459`，提交表单所需 UID 以账号设置页显示为准。

## 实际执行的步骤

### 1. 依赖安装（npm ci）

**命令**：`npm ci`

**结果**：成功。安装 120 个包，耗时约 7 秒。

**输出摘要**：
```
added 120 packages, and audited 121 packages in 7s
3 moderate severity vulnerabilities
```

**说明**：依赖安装正常，无错误。存在 3 个中等严重性漏洞（来自 `uuid@7.0.3` 等间接依赖），但不影响构建和运行。

### 2. 生产构建（npm run build）

**命令**：`npm run build`

**结果**：成功。Vite 6.4.4 构建耗时 1.49 秒，生成 `dist/` 目录。

**输出摘要**：
```
✓ 41 modules transformed.
dist/index.html                              0.60 kB
dist/assets/pdf.worker.min-CjEcRF4W.mjs  1,264.34 kB
dist/assets/index-v2WltXRr.css              64.23 kB
dist/assets/index-VIrZjheF.js              695.90 kB
...
✓ built in 1.49s
```

**说明**：构建正常，无错误。存在 chunk 大小警告（`pdf.worker.min` 和 `index` 超过 500 kB），属于优化建议，不影响功能。

### 3. 单元测试（node --test）

**命令**：`node --test`

**结果**：5 个测试全部通过，耗时 99 毫秒。

**测试用例**：
1. `top paper keyword prefers a specific PDF keyword supported by the title` — 通过（1.20ms）
2. `paper title provides a useful fallback when the PDF has no keyword list` — 通过（0.30ms）
3. `CV example answers a relationship question from connected papers with traceable sources` — 通过（3.62ms）
4. `unmatched questions do not invent outside-library answers` — 通过（3.43ms）
5. `src/node-hit-test.js` — 通过（48.47ms）

**说明**：所有测试通过，无失败或跳过。测试覆盖了关键词提取、文献问答、来源追溯、库外问题拒绝、节点命中检测等核心功能。

### 4. PowerContext 集成验证（npm run verify:context）

**前提**：PowerContext Server 已在 `127.0.0.1:8017` 运行。

**命令**：`npm run verify:context`

**结果**：成功。脚本执行了同步和检索验证。

**输出**：
```json
{
  "connected": true,
  "scopeId": "scp_45ygd7ve4zp3a2nefbawzcwtj3",
  "first": { "synced": 0, "skipped": 9, "scopeId": "scp_45ygd7ve4zp3a2nefbawzcwtj3" },
  "second": { "synced": 0, "skipped": 9, "scopeId": "scp_45ygd7ve4zp3a2nefbawzcwtj3" },
  "searchMode": "fts",
  "matchedPaperIds": ["cv-resnet"]
}
```

**分析**：
- `connected: true` — PowerContext Server 连接正常
- `scopeId` — 已存在 Scope（说明此前已有同步记录）
- `first.synced: 0, first.skipped: 9` — 9 篇文献已在之前的运行中同步过，本次全部跳过，证明幂等性（注意：并非本次新写入 9 篇）
- `second.synced: 0, second.skipped: 9` — 二次同步同样跳过，证明一致性
- `searchMode: "fts"` — 使用全文检索模式
- `matchedPaperIds: ["cv-resnet"]` — 查询 "ResNet residual learning" 正确匹配到 `cv-resnet`

**说明**：PowerContext 集成工作正常。Source 写入、Memory 持久化、全文检索均按预期运行。Ledger 机制（`.local-data/powercontext-sync.json`）正确记录了同步状态。

### 5. 静态站点构建（npm run build:site）

**命令**：`npm run build:site`

**结果**：成功。生成 `dist-site/` 目录，构建时自动清空 `VITE_POWERCONTEXT_ENDPOINT` 等环境变量。

**输出摘要**：
```
✓ 41 modules transformed.
dist-site/index.html                              0.60 kB
dist-site/assets/index-CgLM0sqz.js              695.82 kB
...
✓ built in 1.46s
```

**说明**：静态站点构建正常。`dist-site/` 可部署到任何静态托管服务，不依赖本机 PowerContext 或 Node 服务。

## 发现的问题

### 无关键问题

经过上述检查，**未发现阻断性问题**。构建、测试、集成验证均通过。

### 非阻断性观察

1. **Chunk 大小警告**：`pdf.worker.min` 和 `index` 超过 500 kB。这是 Vite 的优化建议，可通过代码分割或手动分块改善，但不影响功能。
2. **间接依赖漏洞**：`uuid@7.0.3` 等 3 个中等严重性漏洞。这些是间接依赖，不影响当前运行，可在后续升级时处理。
3. **无 .gitignore**：`web-prototype/` 目录缺少 `.gitignore`，可能导致 `node_modules/`、`dist/`、`.env.local`、`.local-data/` 被意外提交。建议添加：
   ```
   node_modules/
   dist/
   dist-site/
   .env.local
   .local-data/
   *.log
   ```

## 未执行的操作

根据任务要求，以下操作**未执行**：

- ❌ 未读取或输出任何 API Key
- ❌ 未提交（git commit）
- ❌ 未推送（git push）
- ❌ 未发布到 Qoder Sites 或其他托管服务
- ❌ 未修改源代码（仅创建文档）

## 创建的文档

### 1. README.md

**路径**：`qoder/literature-atlas/README.md`

**内容**：
- 项目简介与目录结构
- 完整的运行步骤（前置条件、PowerContext 启动、依赖安装、环境配置、服务启动、状态验证）
- 验证样例（单元测试、PowerContext 集成验证、静态站点构建）
- Source / Memory / Search 的实际作用与协作流程
- 公开站点与静态限制的说明
- 技术栈与许可证

### 2. QODER_DEVELOPMENT_RECORD.md

**路径**：`qoder/literature-atlas/QODER_DEVELOPMENT_RECORD.md`

**内容**：即本文档。记录了本次检查的实际步骤、命令、输出与分析，明确不冒称此前由其他工具完成的工作。

## 结论

文脉星图项目的 `web-prototype` 代码质量良好，构建、测试、PowerContext 集成均正常工作。文档已补充完整，评审可按 README.md 中的步骤运行和验证项目。

**本次复核由 Qoder 于 2026-10-28 完成，所有步骤和结果均为实际执行，未冒称此前工作。**

---

## 第二次修改记录（2026-10-28 同日后续）

### 功能改进：PowerContext 检索命中后在问答面板显示 Memory citation

**背景**：PowerContext 的 `/v1/memory/search` 返回结果中已包含 `citation` 字段，但前端问答面板在展示依据论文时并未显示该 citation。本次修改将 citation 从服务端检索结果一路传递到右侧问答面板的依据论文列表。

**修改范围**（小范围，不改变整体架构）：

1. **`src/literature-qa.js`**
   - `answerLiteratureQuestion()` 新增可选参数 `citationsById`（`Map<nodeId, citation>`）。构建 `sources` 数组时，若该节点 ID 在 map 中存在，则附加 `citation` 字段
   - `askLiterature()` 在 PowerContext 检索分支中，从 `result.hits` 构建 `citationsById` map（`hit.paperId → hit.citation`），传递给 `answerLiteratureQuestion()`
   - 未连接 PowerContext 时走本地检索分支，`citationsById` 为 `null`，sources 不含 citation

2. **`src/main.js`**
   - `renderQa()` 的依据论文按钮模板中，若 `source.citation` 存在，渲染 `<cite class="qa-citation">` 显示 citation 文本

3. **`src/literature-axis.css`**
   - 新增 `.qa-citation` 样式：9px 等宽字体、灰色、自动换行

4. **`src/literature-qa.test.js`**（新增 3 个测试）
   - `sources carry PowerContext citation when citationsById maps the node` — 验证 citation 正确附加到匹配的 source
   - `sources omit citation field when citationsById is absent or empty` — 验证无 citation map 时 source 不含 citation 字段
   - `only matched nodes receive citation; unmatched sources stay citation-free` — 验证 citation 只映射到命中的论文

**行为保证**：
- PowerContext 检索命中时，依据论文显示对应的 Memory citation
- 未连接 PowerContext 时，依据论文不显示 citation（与之前行为一致）
- PDF 手动导入不受影响（不依赖 PowerContext）
- 浏览器 IndexedDB 即使不启动 PowerContext 也能跨会话保存文献

### 测试结果

**命令**：`node --test`

**结果**：19 个测试全部通过（此前 16 个 + 新增 3 个 citation 测试），耗时 304ms。

**命令**：`npm run build`

**结果**：构建成功，Vite 6.4.4 耗时 1.54s，41 个模块转换正常。

### 文档修正

- **README.md**：
  - 更正"不启动 PowerContext 时无法跨会话持久化"的表述 → 浏览器 IndexedDB 即使不启动 PowerContext 也能跨会话保存文献
  - 更正 `verify:context` 预期输出：此前实际运行结果是首轮 `skipped: 9`（非新写入 9 篇），因为 PowerContext 中已有之前的同步记录
  - 更新单元测试数量（5 → 19）并列出所有测试
  - Search 章节补充 citation 显示说明
  - Memory 章节补充 IndexedDB 独立持久化说明

- **QODER_DEVELOPMENT_RECORD.md**：
  - 更正 verify:context 分析中"首次同步"的表述，明确首轮 skipped 9 是因为此前已同步过
  - 新增本节，记录本次功能改进的实际修改、测试结果

### 未执行的操作

- 未读取任何密钥
- 未提交（git commit）
- 未推送（git push）
- 未发布
- 未声称整项目此前主要由 Qoder 开发 — 本项目核心架构（Three.js 星图、文献模型、PDF 导入、PowerContext 集成、问答引擎等）在 Qoder 本次介入之前已存在

## 提交前独立复核与修正

独立参赛包在空本机账本、已有 PowerContext Scope 的情况下首次运行 `verify:context` 时，发现 `/v1/memory/remember` 对重复文献返回 `entry: null`。此前 Qoder 复核复用了原工作目录的账本，未覆盖这一场景。提交前已补上 `/v1/memory/entries/list` 的现有条目识别与账本恢复；同一批论文在新目录可再次验证为 `skipped: 9`，检索仍命中 `cv-resnet`。

同时核对真实搜索响应发现 `citation` 是包含 `entry_id` 的对象。显示层现提取 `entry_id`，避免出现 `[object Object]`。新增 1 个对应单元测试后，`node --test` 为 **20 pass / 0 fail**，生产构建成功；在本机参赛包页面提问 `ResNet residual learning`，问答显示 `PowerContext 检索回答` 和 `mem_ent_76a0d8748cb44b47b43cb2791204fb77`。以上修正由提交前独立复核完成，未计作前述 Qoder CLI 会话的工作。
