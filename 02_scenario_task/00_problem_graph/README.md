# 研究问题图

本目录定义 `02_scenario_task` 的核心装配模型：如何把用户意图、场景约束和标准任务合同组合成一张可分支、可合流、可失效传播的 **Research Problem Graph**。

它补的是两层既有图之间的空白：

```text
Research Problem Graph（02）
  ├─ 引用 01 的 ResearchQuestion / JudgmentUnit / Hypothesis 等语义类型
  └─ 向 06 提供待解决 frontier，由 Runtime 编译为 Execution TaskGraph
```

三张图不能混写：

| 图 | 回答的问题 | 权威位置 |
|---|---|---|
| Research Problem Graph | 这项研究由哪些问题、判断单元、竞争解释和缺口组成 | 本目录负责装配合同；对象类型仍引用 `01` |
| Research Provenance Graph | 一个正式结论为什么成立 | `01_semantic_knowledge/03_knowledge_graph` |
| Execution TaskGraph | 这一次 Agent 具体执行哪些节点、依赖和预算 | `06_runtime` |

## 核心原则

- Intent、Scenario、Task Contract 是图的输入目录，不是固定的先后阶段。
- 一个请求可以激活多个 Task motif；多个 motif 可以共享 JudgmentUnit、EvidenceRequirement 和已确认制品。
- Scenario 通过带条件的 `task_affordances` 约束图扩展，不再只提供无类型的候选任务列表。
- Planner 每次只选择未解决或已失效的 frontier，按增量编译执行图。
- 语义关系允许形成复杂网络；单次 Execution TaskGraph 仍必须是无环 DAG。
- 停止依据是问题图覆盖、阻断或显式降级，不是“阶段跑完”。

机器合同见 [`contract.yaml`](contract.yaml)，登记入口见 [`registry.yaml`](registry.yaml)。
