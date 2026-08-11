# 工作区 — 这次任务正在操作什么

> 上级目录：[`04_context_state/`](../README.md) | 根目录：[`README.md`](../../README.md)

回答「这一次任务正在操作什么东西」——AI 当前可读写的工作环境合同。好比研究员的办公桌面——这次研究的中间产物、证据快照、交付包都放在这里。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `contract.yaml` | **合同**：工作区的资源类型和生命周期规则 |

> 物理存储在 `06_runtime/.data/`（由 Runtime 管理，不入 Git）。

## 怎么用

1. **看现行研究产物** → 用工作台 / Runtime 数据，不要在本目录找历史文件夹
2. **改资源类型或生命周期** → 先改合同，再改 Runtime
3. **晋升长期资产** → 从 Workspace Artifact 迁到对应正式域，不要把 Workspace 当知识库

## 怎么维护

- 本目录只保留合同说明，**不存放**本机 SQLite
- 当前 Runtime 以 Task/Artifact/本机数据目录承载工作环境；尚无独立 Workspace 实体或 `workspace_id` 物化

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| 合同 | `contract.yaml` |
| 物理存储 | `06_runtime/.data/`（由 Runtime 管理，不入 Git） |
| status | active |
