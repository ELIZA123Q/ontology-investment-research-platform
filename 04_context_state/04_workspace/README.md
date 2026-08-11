# 工作区（Workspace）

回答「这一次任务正在操作什么东西」：Agent 当前可读写的工作环境合同，不是历史样例仓库。

## 给谁看

- **研究员：** 理解中间产物、证据快照、交付包属于本次任务工作环境
- **维护者：** Workspace 合同与 Runtime 存储实现对齐

## 材料从哪来

- **合同：** [`contract.yaml`](./contract.yaml)
- **物理存储：** `06_runtime/.data/`（由 Runtime 管理，不入 Git）
- **不是 Workspace：**
  - 历史示范 → [`05_control_evaluation/04_verifiers/fixtures/reference_runs/research_runs/`](../../05_control_evaluation/04_verifiers/fixtures/reference_runs/research_runs/README.md)
  - 回归夹具 → [`05_control_evaluation/04_verifiers/fixtures/regression/`](../../05_control_evaluation/04_verifiers/fixtures/regression/README.md)

## 怎么用

1. 看现行研究产物 → 用工作台 / Runtime 数据，不要在本目录找历史文件夹。
2. 改资源类型或生命周期 → 先改合同，再改 Runtime。
3. 晋升长期资产时，从 Workspace Artifact 迁到对应正式域，不要把 Workspace 当知识库。

当前 Runtime 以 Task / Artifact / 本机数据目录承载工作环境；尚无独立 Workspace 实体或 `workspace_id` 物化。

## 怎么维护

- 本目录只保留合同说明，不存放样例、回归包或本机 SQLite。
- **status:** active
