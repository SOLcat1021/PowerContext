# 回声剧场 Echoes Theatre

Dify 赛题（800513）的互动冒险作品：检索过去的选择 → 生成下一幕 → 保存本幕 → 回复玩家。关键剧情由真实 PowerContext Runtime 保存到 OceanBase MySQL 模式或嵌入式 seekdb，供新的 Dify 会话召回。

已发布体验：[回声剧场](https://udify.app/chat/5pELB0RgaZSe48V2)。2026-10-29 已在 Dify Cloud 的真实工作区完成两个独立会话，并直接通过 seekdb SQL 读回它们的剧情正文。演示使用临时 HTTPS 隧道连接本机后端，电脑、后端和隧道均需保持运行；隧道重启后应更新 Dify 环境变量。复现和长期部署请使用下方的完整后端源码及部署配置。

## 评审入口

| 材料 | 内容 |
|---|---|
| `echoes-theatre.yml` | Dify DSL，完整 JSON 序列化、实际 Scope ID 和 Bearer 鉴权配置 |
| `echoes-theatre.ifpkg` | Dify 当前应用包格式，和 YAML 相同的流程；已清空实例地址、Scope、Secret，并重算包清单校验值 |
| `serve_backend.py` | 启动真实 PowerContext Server，强制使用 OceanBase/seekdb，无内存字典或 SQLite 替代路径 |
| `backend/powercontext/src/` | 完整后端源码，包含 HTTP 路由、Memory 业务和 OceanBase 持久化实现 |
| `backend/UPSTREAM.json` | 来源、固定提交和打包差异 |
| `backend/source-sha256.json` | 原始源码校验清单 |
| `tests/acceptance.py` | 真实 HTTP、跨进程恢复、独立 SQL 读回和 Scope 隔离验收 |
| `evidence/acceptance.json` | 实际生成的请求结果、数据库身份、表结构和持久化内容 |
| `evidence/dify-round1.jpg`、`dify-round2.jpg` | Dify 实际执行成功、重新开始会话后准确召回的截图 |
| `evidence/dify-sql.json` | 两次 Dify 调用产生的真实数据库正文、Artifact 清单和表结构 |
| `evidence/README.md` | 证据对应关系、实际验证范围和运行限制 |

后端来自公开仓库 [SOLcat1021/PowerContext](https://github.com/SOLcat1021/PowerContext/tree/3f9a93b6578dcf8517e424af93273bf27ddc0572)，固定提交 `3f9a93b6578dcf8517e424af93273bf27ddc0572`，保留 Apache-2.0 许可。Runtime 源码未改写；打包元数据改用静态版本，并将嵌入式绑定固定到验收实际使用的 `pylibseekdb==1.3.0.post4`；源码 ZIP 无需嵌套 `.git` 即可安装。

## 启动真实后端

需要 Linux x86_64 和 Python 3.12。默认使用真正的嵌入式 seekdb，数据目录由 `POWERCONTEXT_SEEKDB_PATH` 指定，数据库由后端启动和关闭。从本目录执行：

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock.txt
pip install --no-deps ./backend/powercontext
cp .env.example .env
# 编辑 .env 中的数据目录和随机 Bearer Token
set -a
. ./.env
set +a
python serve_backend.py
```

也可改用外部 OceanBase MySQL 租户：先创建 `echoes_dify` 数据库，注释掉 `.env` 中的 `POWERCONTEXT_SEEKDB_PATH`，再设置 `POWERCONTEXT_DATABASE_URL`。URL 格式为 `mysql+aoceanbase://USER:PASSWORD@DB_HOST:2881/echoes_dify?charset=utf8mb4`，密码中的特殊字符需 URL 编码。使用 PowerContext 的 OceanBase 存储适配器，通过 SQLAlchemy/pyobvector 连接真实数据库：Scope 位于 `pc_scopes`，剧情清单位于 `pc_artifacts`，正文和不可变版本位于 `pc_memory_entry_versions`，检索投影位于 `pc_artifact_heads` 等索引表。

填写 `.env` 后也可执行 `docker compose up --build -d`；容器模式必须设置非空 `POWERCONTEXT_TOKEN`，数据库地址必须能从容器内访问。Compose 默认只将 HTTP 端口映射到宿主机回环地址。Dify 若在另一台主机或云端，需要使用其可访问的 HTTPS 后端地址并配置 Token；云端不能访问你电脑的 `127.0.0.1`。容器配置供复现使用，实际执行的验证范围见证据文件。

## 初始化与 Dify 配置

必须先设置 Token、启动启用鉴权的后端，再初始化 Scope。保持后端运行，在另一个加载相同 `.env` 的终端执行 `python bootstrap_powercontext.py`。脚本打印 `POWERCONTEXT_SCOPE_ID=<实际 ID>`；将它写入 `.env` 和 Dify 环境变量。`POWERCONTEXT_SCOPE_KEY` 只是创建 Scope 的幂等键，不能替代实际 ID。先前以关闭鉴权的方式创建的数据没有认证主体归属，之后开启鉴权不能直接复用；应在启用鉴权后用新的幂等键创建演示 Scope。

导入 `echoes-theatre.yml` 后填写：

- `POWERCONTEXT_BASE_URL`：Dify 服务端可访问的后端地址。
- `POWERCONTEXT_SCOPE_ID`：初始化脚本返回的实际 ID。
- `POWERCONTEXT_TOKEN`：后端 Token，在 Dify 中按 secret 保存。

DSL 使用实际 Dify 导出的格式，由 Python 代码节点先 `json.dumps`，再传输单个完整 JSON，正确保留引号、换行和整数。节点使用数字 ID，确保 Dify 正确插值代码节点输出；原来的带连字符 ID 导致 HTTP body 没有展开，这已在实际运行中修复。默认导演模型为 `gpt-4o-mini`，本次使用工作区免费试用额度；复现时应选择自己工作区可用的聊天模型。不要把模型密钥或后端 Token 写进 DSL。

显式记忆写入是追加操作，保存节点关闭自动重试，避免写入成功但响应丢失后产生重复剧情。遇到不确定的写入错误，应先检索或查看 Memory，再决定是否重试。

## 可复跑验收

先停止手工启动的 HTTP 后端；使用外部 OceanBase 时保持数据库运行。脚本启动、停止自己的两个后端子进程；嵌入式模式下每个后端均独立打开和关闭同一磁盘数据库，随后第三次打开它做独立 SQL 检查：

```bash
python tests/verify_backend_source.py
python tests/acceptance.py evidence
```

验收检查：空 Scope 无命中；写入带中文、引号、换行、反斜杠和随机标记的剧情；新 HTTP 会话可检索；第二个独立后端进程仍可检索；其他 Scope 不命中；直接 SQL 在同一数据库读到带随机标记的正文，并核对其所属 Artifact 清单和内容哈希，并记录 `VERSION()` 和 `SHOW CREATE TABLE`。

该脚本运行真实 PowerContext HTTP 和嵌入式 seekdb，也执行 DSL 内的 JSON 构造代码，不调用 Dify 引擎或剧情生成模型；因此 `evidence/acceptance.json` 的 `dify_engine_executed` 标记为 false。另有真实 Dify Cloud 运行证据：`evidence/dify-round1.*`、`dify-round2.*`、`dify-sql.json` 和已发布页面截图，验证范围相互独立。

## 应用体验与提交

配置、发布后，输入“我把会发光的钥匙交给戴面具的猫。”；另开 Dify 会话输入“之前钥匙交给谁了？”。检查检索节点的真实 `hits`、导演输入中的旧剧情和保存节点返回的 Memory 引用。固定 Scope 代表同一位演示玩家；不同玩家应分别使用自己的 Scope。

提交时打包整个 `dify/`，保留后端源码、固定依赖、验证脚本和 `evidence/`，不能仅上传 YAML。演示固定 Scope 中的内容均为本次虚构剧情；公开体验入口的使用者共享这一演示 Scope，不应输入私人数据。后端源码、真实 Dify 跨会话运行和 HTTP/SQL 证据用于证明指定技术承载核心剧情数据，最终得分以赛事评审为准。
