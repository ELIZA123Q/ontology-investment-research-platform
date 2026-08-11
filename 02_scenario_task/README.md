# 场景任务域

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

**定位：** 定义「用户的研究问题如何展开成可组合、可分支、可回溯的 Research Problem Graph」；不负责能力怎么实现，也不负责这一次具体怎么执行。

```text
User Request
  ├─ Intent ───────────────┐
  ├─ Scenario constraints ─┼─→ Research Problem Graph（02）
  └─ Task motifs ──────────┘        │ unresolved frontier
                                    ▼
                         Runtime Execution TaskGraph（06）
```

这里的箭头表示关系，不表示固定流水线。一次请求可以激活多个 Task motif；它们可以共享判断单元与证据，也可以在新事实到来后只重算受影响的子图。

## 材料从哪来

| 子目录 | 含义 |
|---|---|
| [`00_problem_graph/`](00_problem_graph/) | Intent / Scenario / Task motif 的图装配合同 |
| [`01_intents/`](01_intents/) | 用户级 Intent（≠ Runtime ResearchIntent） |
| [`02_scenarios/`](02_scenarios/) | 场景类型 + SCN 场景卡 |
| [`03_tasks/`](03_tasks/) | 用户级 Research Task Contract + 可组合 graph motif |
| [`04_roles/`](04_roles/) | 责任位（Role ≠ Agent） |
| [`05_workflow_patterns/`](05_workflow_patterns/) | frontier 选择与扩展的 Planner prior（无 Stage 01–05） |

真正「这次怎么跑」由 [`06_runtime/`](../06_runtime/README.md) 动态规划。怎么思考见 [`03_agent_capability/02_skills/`](../03_agent_capability/02_skills/README.md)。

## 怎么用

1. 用 `01_intents`、`02_scenarios` 和 `03_tasks` 激活一个或多个图 motif。
2. 按 `00_problem_graph` 合并共享节点、施加场景约束并选择 unresolved frontier。
3. `06_runtime` 只把当前 frontier 编译成可执行 TaskGraph；结果回写后按失效传播增量重规划。

## 怎么维护

- 新场景卡只写本域；研究框架资源留在 `research-design` Skill，不回写本域。
- 禁止恢复固定 01→05 controller。
- 禁止把 `Intent → Scenario → Task` 当成必须单选、单向、一次性的主链。
- 新 Task 必须声明 `graph_motif`，但不得在 motif 中绑定具体 Skill、Tool 或 Runtime Node。
- 可执行节点改 `06_runtime` 的 node-catalog / planner。
