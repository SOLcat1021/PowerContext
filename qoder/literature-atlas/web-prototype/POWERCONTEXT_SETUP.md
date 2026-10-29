# 无模型 API 的 PowerContext 接入

文脉星图默认支持浏览器本地手动导入 PDF 和编辑文献。连接 PowerContext 后，已确认的文献信息会写入它的 Source 与 Memory；问答先调用 PowerContext Memory 全文检索，再用当前文献库内容组织可追溯的回答。**不需要模型 API Key**。PDF 原件仍留在浏览器 IndexedDB，不传给 PowerContext。

## 本机运行

需要 Node.js 20+、Python 3.11+ 和 `uv`。Windows 上请显式选择 Python 3.12：

```powershell
uv tool install --python 3.12 "powercontext[cli,server]==1.2.0"
& "$HOME\.local\bin\powercontext.exe" server run --host 127.0.0.1 --port 8017
```

在第二个终端进入 `web-prototype`：

```powershell
Copy-Item .env.example .env.local
npm ci
npm run build
npm run start:local
```

打开 `http://127.0.0.1:4174/`。在文献库中点击“同步当前文献”，或直接上传一篇 PDF。页面会显示同步结果。`/api/context/health` 只返回连接状态和 Scope ID，不返回鉴权 Token。

可运行的验证样例：在保持两个服务运行时执行 `npm run verify:context`。该脚本把 9 篇 CV 示例文献同步到 PowerContext；首次同步应写入 9 篇，再次同步应跳过 9 篇，`ResNet residual learning` 检索应返回 `cv-resnet`。这些结果来自真实 PowerContext API，不依赖模型。同步状态保存在本机 `.local-data/powercontext-sync.json`，该目录已被 Git 忽略。

如已存在自己的 Scope，可在 `.env.local` 设置 `POWERCONTEXT_SCOPE_ID`；否则服务端用固定幂等键创建文脉星图 Scope。PowerContext Server 开启鉴权时，在 `.env.local` 设置 `POWERCONTEXT_TOKEN`，不要在浏览器变量或 Skill 中保存它。若不启动 PowerContext，网站仍可手动导入和本地检索，并明确标注未连接状态。

当前集成面向单机单用户，Node 服务默认只监听 `127.0.0.1`。公开 Qoder Sites 页面是静态演示，不会连接用户电脑上的 PowerContext；评审可按上述步骤运行本地核心功能。Windows 运行 PowerContext 在官方文档中仍标记为实验性。
