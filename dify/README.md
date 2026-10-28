# 回声剧场 Echoes Theatre

这是 OceanBase 2026 数据库大赛 Dify 赛题（题号 \`800513\`）的作品目录。作品把一次互动冒险做成 Dify Chatflow：Dify 编排输入、回忆检索、剧情生成和最终回复；PowerContext 保存玩家的关键选择，并在下一轮或新会话中召回这些选择。

## 作品与题目要求的对应关系

- **Dify**：\`echoes-theatre.yml\` 是可导入的 Dify DSL，核心链路是“召回记忆 → LLM 导演 → 保存本幕 → 回复玩家”。
- **PowerContext**：工作流实际调用 \`POST /v1/memory/search\` 和 \`POST /v1/memory/remember\`。检索结果会进入导演提示词，导演生成的本轮互动会写回同一 Scope。
- **可体验玩法**：玩家用一句话做出行动，导演推进剧情并给出两个后续选择；随后重新提到先前的道具、角色或线索，作品会利用跨回合记忆继续发展。

## 运行环境

建议使用 Dify 1.16.x（DSL \`0.7.0\`）或兼容 \`0.7.0\` 的版本，并准备一个可访问的 PowerContext HTTP 服务。Dify 与 PowerContext 在同一台机器运行时，Dify 能访问的地址可能需要写成宿主机地址或容器服务名，不能盲目使用容器内的 \`127.0.0.1\`。

### 1. 启动 PowerContext 并初始化演示数据

在 PowerContext 服务启动后执行：

\`\`\`bash
export POWERCONTEXT_BASE_URL=http://127.0.0.1:8000
export POWERCONTEXT_SCOPE_ID=dify-echoes-demo
python dify/bootstrap_powercontext.py
\`\`\`

如果服务启用了 Bearer 鉴权，再设置 \`POWERCONTEXT_TOKEN\`。脚本会创建或复用一个 Scope，并写入 3 条初始剧情记忆。它最后打印实际 Scope ID；把该值用于下一步 Dify 环境变量。

### 2. 导入 Dify DSL

在 Dify 工作室中选择“创建应用 → 导入 DSL”，导入 \`echoes-theatre.yml\`。导入后在应用的环境变量中设置：

| 变量 | 示例 | 作用 |
|---|---|---|
| \`POWERCONTEXT_BASE_URL\` | \`http://127.0.0.1:8000\` | PowerContext 服务地址 |
| \`POWERCONTEXT_SCOPE_ID\` | \`dify-echoes-demo\` | 由初始化脚本创建的 Scope |

如果 Dify 工作区没有同名的通义千问模型，在“导演：生成下一幕”节点中选择当前可用的聊天模型即可；不要修改工作流的 HTTP 请求、记忆字段或节点连接。

### 3. 验证 PowerContext

在导入 DSL 的环境中运行：

\`\`\`bash
python dify/verify_powercontext.py
\`\`\`

该脚本会检索初始化数据，证明 PowerContext 中的故事事实确实可被召回。Dify 应用的验证入口是发布后的 Web App 或 API。

## 验证样例

1. 新建一个会话，输入：\`我把会发光的钥匙交给戴面具的猫。\`
2. 预期：Dify 返回一幕不超过 180 字的剧情、一个意外细节和两个后续行动，并在末尾给出“本幕记忆”。
3. 重新开始一个新会话，输入：\`我想回顾月亮车站的线索。\`
4. 预期：Dify 通过 \`echoes-search\` 找到初始化记忆或上一幕记忆，回复中提到月亮车站、猫或之前的选择，并继续剧情。
5. 在 Dify 调试面板查看两个 HTTP 节点：\`echoes-search\` 应返回 \`200\` 和 \`hits\`；\`echoes-remember\` 应返回 \`200\` 或 \`201\`。这两条记录就是指定技术实际参与应用功能的运行证据。

连续操作的恢复方式：删除 Dify 会话后重新开始即可；PowerContext 中已写入的记忆可以保留，也可以删除演示 Scope 后重新运行初始化脚本。

## 提交材料清单

- \`echoes-theatre.yml\`：完整 DSL。
- 本文件：作品创意、技术分工、版本和完整运行步骤。
- \`bootstrap_powercontext.py\`：可重复运行的 Scope 与初始记忆初始化脚本。
- \`verify_powercontext.py\`：检索验证脚本。
- 提交时附上 Dify 调试面板中两个 HTTP 节点的成功记录，以及一次“新会话召回旧剧情”的截图或录屏。

不要把 Dify API Key、PowerContext Token、密码或其他凭据写入 DSL、脚本或截图；在评审环境中通过环境变量配置。

