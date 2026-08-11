# 场景任务域

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

**定位：** 定义「用户想完成什么研究任务，以及这个任务处于什么研究场景」；不负责能力怎么实现，也不负责这一次具体怎么执行。

```text
User Request → Intent → Scenario → Task Contract
──────────────────────────────── (02 边界)
Research Lead → Runtime Planner → TaskGraph → Skill / Tool
```

## 材料从哪来

| 子目录 | 含义 |
|---|---|
| [`01_intents/`](01_intents/) | 用户级 Intent（≠ Runtime ResearchIntent） |
| [`02_scenarios/`](02_scenarios/) | 场景类型 + SCN 场景卡 |
| [`03_tasks/`](03_tasks/) | 用户级 Research Task Contract |
| [`04_roles/`](04_roles/) | 责任位（Role ≠ Agent） |
| [`05_workflow_patterns/`](05_workflow_patterns/) | Planner prior（无 Stage 01–05） |

真正「这次怎么跑」由 [`06_runtime/`](../06_runtime/README.md) 动态规划。怎么思考见 [`03_agent_capability/02_skills/`](../03_agent_capability/02_skills/README.md)。

## 怎么用

1. 定意图与场景 → `01_intents` / `02_scenarios`
2. 定任务边界与交付 → `03_tasks`
3. 需要规划先验 → `05_workflow_patterns`

## 怎么维护

- 新场景卡只写本域；研究框架资源留在 `research-design` Skill，不回写本域。
- 禁止恢复固定 01→05 controller。
- 可执行节点改 `06_runtime` 的 node-catalog / planner。
