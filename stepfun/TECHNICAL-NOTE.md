# StepFun 题技术说明

## 方案

`src/main.tsx` 使用 `@huggingface/transformers` 在浏览器中加载公开的 `Xenova/all-MiniLM-L6-v2`。初始化优先请求 WebGPU + FP16；WebGPU 不可用或初始化失败时自动切换到 WASM + INT8（q8），页面持续显示当前后端。文档 embedding 和查询 embedding 都在浏览器中生成，服务端 API 只接收向量、原文和查询字符串，不调用云端推理 API。

`server/index.ts` 使用 `seekdb` 的 JavaScript SDK。集合声明 384 维 cosine HNSW 向量索引和 IK 全文索引，客户端生成的向量与原文、标题一起写入 seekdb。搜索使用 SDK 的单次 `hybridSearch()`，由 seekdb 完成关键词与向量候选的融合排序；客户端不会分别取两路结果再拼接。新增文档写入完成后才更新本地文档计数，后续查询直接读取同一集合。

## 启动

```bash
cd stepfun
pnpm install
pnpm run dev
```

打开 `http://localhost:5173`。默认嵌入式数据库目录是 `stepfun/.data/stepfun.db`，也可以设置 `SEEKDB_PATH`。服务器模式可将 `server/index.ts` 的 `SeekdbClient` 配置替换为本地 seekdb server 的 host/port 配置。

## 性能记录方法

界面底部的指标卡会按操作累计样本并显示中位数，覆盖首次模型加载、文档向量化、seekdb 写入/索引刷新、查询向量、seekdb 检索和端到端耗时；重复导入和查询即可分别观察冷启动与 warm 请求。测试时固定设备、Chrome/Edge 版本、语料和查询集，并分别记录 WebGPU 与 WASM 的结果。量化对比按模型文件总体积计算 `原始体积 / INT8 体积`，质量对比使用固定语料和查询集的 Recall@K 或 nDCG@K。

## 约束核对

- 现代 Chrome / Edge：Vite 生产构建输出静态前端。
- 本地推理：模型运行时在前端，后端不持有模型或向量生成逻辑。
- WebGPU → WASM：明确的后端选择与降级提示。
- seekdb 数据层：向量、原文、元数据都进入 seekdb，混合检索只调用一次 `hybridSearch()`。
- 增量导入：每个文件独立写入，可连续导入并保留同一集合状态。
