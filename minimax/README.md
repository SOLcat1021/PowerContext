# MiniMax SDD 工程上下文模块

任务 TASK-PRIORITY：为一个已有状态筛选能力的任务列表模块增加优先级筛选，同时保持顺序、位置参数和输入拷贝行为。

代码基于 `2026-competition-ecosystem`，独立目录 `minimax/`。采用 MiniMax 官方 CLI 0.7.1 的非交互入口，实际调用模型为 `MiniMax-M3.1-Flash`。API 接入不是模拟，详见 `evidence/minimax-response.json` 的 model、sessionId、runId 和用量。

## 分工与上下文

- `context.py`：把规格、业务代码和测试保存为 PowerContext Memory，通过真实 seekdb 全文查询构造上下文，来源带文件路径和 SHA256。每次重新导入创建新材料 Scope，全部成功后切换活动导入，避免旧规格混入新任务。
- `run_minimax.py`：先运行修改前测试，再将数据库返回的真实上下文交给已有开发助手 MiniMax Code；它修改 `sample/tasks.py`。脚本记录提示词、回复、差异和相同测试的前后结果，并检查测试未被改变。
- `serve_backend.py`：真实 PowerContext Server + 嵌入式 seekdb；不使用 SQLite 替代。数据库同时保存工程材料及任务进度。
- `verify.py`：新进程恢复任务状态，并证明更新规格、重新导入后返回新内容，恢复状态被实际放入后续上下文。
- `verify_database.py`：后端停止后直接 SQL 查同一数据库，核对材料和进度持久化。

使用 PowerContext 明确保存 Memory 无需额外生成模型。工程内容小于单条 8192 UTF-8 字节限制，当前样例按文件导入，适合此局部任务；大型工程需进一步分块和选择符号。本版本不恢复 MiniMax 的完整会话，重启后复用的是工程任务记录。

## 从干净环境启动

后端要求 Linux x86_64、Python 3.12，可在 Windows WSL 中运行。源码与依赖均随本目录交付：

```bash
cd minimax
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock.txt
pip install --no-deps ./vendor/powercontext
export MINIMAX_SEEKDB_PATH="$PWD/.runtime/seekdb"
python serve_backend.py
```

默认只监听 `127.0.0.1:18280`。如需要本地 Bearer 鉴权，服务端和所有调用端设置相同 `MINIMAX_CONTEXT_TOKEN`，其值不入库、不写入示例。Windows 调用端只用 Python 标准库；WSL 的 localhost 转发需开启，或直接在 Linux 上运行所有命令。

MiniMax 安装和登录：

```powershell
npm.cmd install -g @minimax-ai/code@0.7.1
mcode login --region cn
```

Node.js 要求见官方文档，本次使用 24.16.0。登录由用户在官方浏览器页面完成，凭据由 CLI 保存在个人配置中。需要可用账号额度，不随仓库提供账号或 Key。

## 复现实际修改

在 `minimax/` 下运行。交付的 `sample/tasks.py` 已是 MiniMax 修改后的版本。如需从修改前复现，先备份自己的改动，再用交付快照重置这个演示文件（不使用 git 强制重置）：

```powershell
Copy-Item evidence/tasks.before.py sample/tasks.py
python context.py import
python run_minimax.py
```

Linux 用 `cp` 替代 Copy-Item。调用入口 `prepare(task)` 输入任务文字，输出真实规格、代码、测试来源及先前保存的进度。默认任务查询为 `task priority filter`；无匹配资料报错，不返回固定答案。实际执行会覆盖该轮 evidence，保留原证据时请先复制本目录。

停止后端（Ctrl+C），用相同数据路径再次启动，然后在另一个终端执行：

```powershell
python verify.py
python -m unittest discover -s sample -v
```

`verify.py` 暂时添加随机规格修订标记、重新导入并断言返回新内容，最后恢复原规格并再次导入。任务状态由 PowerContext 读取，`.runtime/active.json` 只记录 Scope 指针，不是任务状态替代品。

停止后端后，在 Linux 且相同 `MINIMAX_SEEKDB_PATH` 下执行：

```bash
python verify_database.py
```

单纯复查已交付代码无需 MiniMax 额度：`python -m unittest discover -s sample -v`。目标和回归测试保持同一 SHA256；原始目标失败原因是缺少 priority 参数，非安装/依赖/启动错误。

## 证据与来源

`evidence/` 包含修改前后代码、补丁、提示词和真实 CLI 回复、测试命令和退出码、导入收据、实际数据库查询、后端重启后的状态及规格更新验证。截图来自这些原始日志的本地查看器，页面明确标为 evidence viewer，未伪装成 MiniMax 软件界面。`python report.py` 生成查看器，随后 `python -m http.server 18281 --bind 127.0.0.1 --directory evidence` 可查看。

`vendor/powercontext` 为 Apache-2.0 PowerContext 固定源码，来源和提交见 `vendor/UPSTREAM.json`；仅复用包元数据中注明的静态版本和依赖锁定，未改写 Runtime。业务样例及上下文模块为本赛题新建。MiniMax 的后续生成内容可能不同，以测试验证；本次已保存真实生成补丁，无需模型重新生成完全相同代码。
