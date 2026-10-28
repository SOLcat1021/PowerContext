# 用自己的模型额度启用 AI

模型 API 完全可选。文脉星图在无 Key 时仍可手动导入 PDF，连接 PowerContext 做持久检索；本机 PowerContext 启动步骤见 [POWERCONTEXT_SETUP.md](POWERCONTEXT_SETUP.md)。如果希望进一步启用模型综合回答和里程碑判定，可让本机服务端使用你自己的 API Key。**Key 只放在本机 `web-prototype/.env.local`，不要写进 Skill、前端页面、`VITE_` 变量或 Git 仓库。**

1. 在 `web-prototype` 目录复制 `.env.example` 为 `.env.local`。
2. 取消注释并填写 `AI_BASE_URL`（兼容 OpenAI Chat Completions 的 `/v1` 根地址）、`AI_MODEL`、`AI_API_KEY` 与两个 `VITE_LITERATURE_*_ENDPOINT`。所用服务商、模型及计费由使用者自行选择；请求消耗使用者自己的模型额度。
3. 运行 `npm ci`、`npm run build`、`npm run start:local`，浏览器打开 `http://127.0.0.1:4174/`。
4. 打开 `http://127.0.0.1:4174/api/health`，应看到 `configured: true`。此接口不返回 Key。
5. 上传 PDF 后，模型根据提取出的标题、摘要和标签自动判定普通或里程碑节点，并提取核心关键词。右侧文献问答会把当前库内论文信息和已确认关系发给你配置的模型服务，再展示附论文依据的回答。

前端仅将必要的标题、年份、摘要、标签、关系和问题发送到本机服务；**PDF 原件不会上传到模型服务**。模型服务不可用时，节点按普通文献保存；问答优先使用已连接的 PowerContext，未命中时退回本地检索，并明确标注回答来源。这个本机服务默认只监听 `127.0.0.1`，不提供公网部署或多用户密钥管理。

Qoder Skill 可以保存上述配置步骤，帮助用户完成设置，但不能安全地保存或分发真实 API Key。
