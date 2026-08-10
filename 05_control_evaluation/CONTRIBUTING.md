# 开发与校验

## 环境

- Python 3.12
- Node.js 24
- npm（使用 `06_runtime/package-lock.json`）

```bash
python3 -m pip install -r 05_control_evaluation/requirements.txt
npm --prefix runtime ci
```

本机启动前复制 `06_runtime/.env.example` 为 `06_runtime/.env.local`。不要提交 API Key、`.env.local`、
SQLite 数据库或 `04_context_state/03_workspace/00_本机运行` 下的运行导出。

## AI 上下文文件

项目根目录多份 AI 上下文文件需保持同步：

| 文件 | 对应工具 | 同步关系 |
|------|----------|---------|
| `CLAUDE.md` | Claude Code / Claude Desktop | 主力文件 |
| `.cursor/rules/03-evidence-sources.mdc` | Cursor | ← CLAUDE.md |

新增/移除 MCP 数据通道时，同步更新上述文件 + `03_agent_capability/04_protocols/mcp/B03_MCP通道注册.md` + `OPS_MCP查询快速参考.md` + `03_registry.yaml`。

## 必过检查

```bash
python3 05_control_evaluation/03_校验/validate_project.py
python3 05_control_evaluation/03_校验/validate_v3_samples.py
npm --prefix runtime run typecheck
npm --prefix runtime test
npm --prefix runtime run build
```

可选本地检查：

```bash
npm --prefix runtime run lint
python3 -m pip install ruff && ruff check 05_control_evaluation/03_校验
```

废弃关系名守卫（`validate_deprecated_terms.py`）已挂入 `validate_project.py` 主链路，无需单独再跑。

`PROJECT_ENGINEERING_PASS` 只表示合同、代码、样例、真实工作台冻结夹具和 mock 协议烟测通过；
它不表示正式 R/U/delta/S/C 或研究可靠率已经验证。

## 变更边界

- 公共字段、ID、跨阶段引用先改 `05_control_evaluation/02_合同/public_contract.yaml`，再同步 Runtime、校验器和样例。
- `semantic_fixture`、`workbench_export`、`formal_pack` 必须使用各自校验入口，不得互相冒充。
- Runtime 的多步写路径应使用事务；外部网络调用不得在数据库写事务内执行。
- 新增正式规则时必须登记唯一权威和执行面；未实现规则不得写成已重算挡门。
