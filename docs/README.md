# 项目级文档

这里保存不属于单一职责域、但需要长期维护的项目级资料；它不是 Runtime 输入目录。

| 目录 | 职责 | 是否可作为现行权威 |
|---|---|---|
| [`architecture/`](architecture/README.md) | 项目边界、五域职责、仓库布局与跨域权威索引 | 是 |
| [`migrations/`](migrations/) | 已完成的结构或语义迁移账本、只读基线 | 仅用于迁移审计 |
| [`roadmap/`](roadmap/README.md) | 历史目标、决策记录与实施账本 | 否 |

贡献与本地校验说明见仓库根目录的 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。

新增文档前先判断是否应由某个职责域拥有：业务语义归 `01_semantic_knowledge/`，任务定义归 `02_scenario_task/`，能力资产归 `03_agent_capability/`，状态合同归 `04_context_state/`，控制与评测归 `05_control_evaluation/`，实现归 `06_runtime/`。
