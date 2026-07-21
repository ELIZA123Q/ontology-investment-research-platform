# 开发与校验

## 环境

- Python 3.12
- Node.js 24
- npm（使用 `runtime/package-lock.json`）

```bash
python3 -m pip install -r governance/requirements.txt
npm --prefix runtime ci
```

本机启动前复制 `runtime/.env.example` 为 `runtime/.env.local`。不要提交 API Key、`.env.local`、
SQLite 数据库或 `instances/00_本机运行` 下的运行导出。

## 必过检查

```bash
python3 governance/03_校验/validate_project.py
npm --prefix runtime run typecheck
npm --prefix runtime test
npm --prefix runtime run build
```

可选本地检查：

```bash
npm --prefix runtime run lint
python3 -m pip install ruff && ruff check governance/03_校验 runtime/engine
```

`PROJECT_ENGINEERING_PASS` 只表示合同、代码、样例、真实工作台冻结夹具和 mock 协议烟测通过；
它不表示正式 R/U/delta/S/C 或研究可靠率已经验证。

## 变更边界

- 公共字段、ID、跨阶段引用先改 `governance/02_合同/public_contract.yaml`，再同步 Runtime、校验器和样例。
- `semantic_fixture`、`workbench_export`、`formal_pack` 必须使用各自校验入口，不得互相冒充。
- Runtime 的多步写路径应使用事务；外部网络调用不得在数据库写事务内执行。
- 新增正式规则时必须登记唯一权威和执行面；未实现规则不得写成已重算挡门。
