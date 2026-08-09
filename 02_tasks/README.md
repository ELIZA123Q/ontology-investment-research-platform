# 场景任务域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

这里回答「一次研究要完成什么」：有哪些场景、标准任务长什么样、角色怎么分工、有哪些可选工作流模板。

## 给谁看

- **研究员**：找场景样例、理解任务该输出什么
- **维护者**：登记场景/任务定义；注意 Deep Research 不是现行主路径

## 材料从哪来

| 子目录 | 白话含义 |
|---|---|
| [`01_scenarios/`](01_scenarios/README.md) | 可复用的研究场景包（含半导体等） |
| [`02_definitions/`](02_definitions/README.md) | Intent / Task 等标准定义 |
| [`03_roles/`](03_roles/README.md) | 研究角色说明（与 Runtime 当前启用 Agent 对照） |
| [`04_workflows/`](04_workflows/README.md) | 可选工作流模板；含历史 Deep Research |

真正「这次怎么跑」由 [`07_runtime/`](../07_runtime/README.md) 的动态规划决定；本域提供场景与模板材料，不是固定阶段控制器。

## 怎么用

1. 要套行业场景 → 从 [`01_scenarios/`](01_scenarios/README.md) 选包。
2. 要写清任务边界与产出 → 看 [`02_definitions/`](02_definitions/README.md)。
3. 需要旧 Deep Research 阶段文档当参考模板 → 进 [`04_workflows/deep_research/`](04_workflows/deep_research/README.md)，**不要**把它当成现行必须走完的 01→05 流水线。

## 怎么维护

- 新场景、新任务定义写入本域，并更新 [`registry.yaml`](./registry.yaml)。
- Deep Research 仅作可选模板维护；禁止恢复「固定 01→05 controller」。
- 可执行节点与规划逻辑改 [`07_runtime/src/runtime/node-catalog.ts`](../07_runtime/src/runtime/node-catalog.ts) 与 `planner.ts`，改完跑 Runtime 测试与 `audit-cutover`。

---

## 维护者附录（可跳过）

| 项 | 值 |
|----|----|
| status | `active`（Intent/Task/typed TaskGraph 为运行主链） |
| write_entry | `02_tasks/`；Deep Research 仅可选模板 |
| 执行权威 | `07_runtime` 的 node-catalog / planner |
| 上位 | [`00_五域系统骨架.md`](../05_governance/01_架构/00_五域系统骨架.md) |
