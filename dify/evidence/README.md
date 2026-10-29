# 真实执行与核心存储证据

记录日期：2026-10-29。Dify Cloud 应用：[回声剧场](https://udify.app/chat/5pELB0RgaZSe48V2)，应用 ID `de8cb63e-070d-4e18-a301-b7fd4cd57d3c`。后端为随包提供的真实 PowerContext，数据库身份为 `5.7.25-OceanBase seekdb-v1.3.0.0`，由 `pylibseekdb==1.3.0.post4` 启动。

## Dify 的实际执行

1. `dify-round1.txt` / `dify-round1.jpg`：输入“我把蓝色怀表交给穿黄雨衣的狐狸，约定暗号是‘星砂27’”，真实工作流显示运行成功并生成剧情。
2. `dify-round2-reset.txt`：点击“重新开始”后的空预览，清除 Dify 当前会话上下文。
3. `dify-round2.txt` / `dify-round2.jpg`：新会话只问“之前蓝色怀表交给了谁？当时约定的暗号是什么？”，没有提示人物和暗号；模型准确回答黄雨衣狐狸及星砂27，工作流运行成功。
4. `dify-sql.json`：通过运行中嵌入式 seekdb 的原生 SQL socket 独立查询，读回上述两次 Dify 调用写入的 `echoes_theatre_interaction` 正文，含各自的玩家问题及导演回答。Scope 为 `scp_386sf0rnqqregqc7sf698hmng0`；同时记录 Artifact 修订清单及 `SHOW CREATE TABLE pc_memory_entry_versions`。
5. `dify-published.jpg` / `dify-access-point.jpg`：实际发布状态及可访问入口。模型为工作区试用 `gpt-4o-mini`。
6. `dify-webapp.txt` / `dify-webapp.jpg`：发布后的独立 Web 应用实际运行成功，再次准确召回人物与暗号。

核心数据保存在 `pc_memory_entry_versions.text`，`pc_artifacts.content` 保存相应版本清单；并非仅在 DSL 标注接口、仅用 Dify 聊天历史，或用本地 JSON 假装数据库。

## 后端的独立验收

`acceptance.json` 与 `backend-process-1.log`、`backend-process-2.log` 验证真实 HTTP 写入、独立进程重启后的召回、Scope 隔离、含特殊字符的完整正文和数据库 SQL 读回。该验收未运行 Dify 引擎，因此其 `dify_engine_executed` 为 false；上面的 Cloud 证据记录了独立的真实 Dify 执行。

`auth-local.json` 和 `auth-https.json` 记录无 Token 返回 401、正确 Token 返回 200，后者通过已获用户同意的临时 HTTPS 隧道访问。Token 只保存在本机私有配置和 Dify secret 中，不包含在 DSL、证据或提交包内。

## 验证边界

实际完成的是 Linux/Python 3.12 原生运行、PowerContext + 嵌入式 seekdb、Dify Cloud 的两个独立会话及发布。Docker 配置和外部 OceanBase 连接方式供部署使用，本次没有执行 Docker 构建，也未将外部 OceanBase 路径描述成已测试。

临时隧道依赖本机后端和隧道进程持续运行，不承诺长期在线。完整源代码、锁定依赖与启动步骤均随包提供，支持独立复现。官方评审是否通过仍需重新提交后确认。
