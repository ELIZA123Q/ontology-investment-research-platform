# 研究角色 — 任务中的责任位置

> 上级目录：[`02_scenario_task/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里定义研究任务中的责任位置（Role）。好比投研团队里的分工——谁负责定方向、谁负责找证据、谁负责建模——Role 定义「需要有人对什么负责」，不指定具体由哪个 AI 来做。

## 里面有什么

当前 5 个角色：

| 角色 | 负责什么 | 当前状态 |
|------|---------|---------|
| `research_owner` | 研究目标与方向的责任拥有者 | 定义就绪 |
| `research_lead` | 研究组织、协调与判断综合 | **已上线**（由 Research Lead Agent 承担） |
| `evidence_investigator` | 只执行证据切片与 evidence_package | 候选，未上线 |
| `financial_modeler` | 只负责财务建模、估值分析和模型审计 | 候选，未上线 |
| `independent_reviewer` | 隔离复核，只输出 review | 候选，未上线 |

## Role 和 Agent 的关系

```
Task  → 定义需要完成什么研究任务
Role  → 定义任务中的责任位置（本目录）
Agent → 声明自己可以承担哪些 Role（03_agent_capability/01_agents/）
Runtime → 根据当前任务和能力确定实际承担者
```

> Role 与 Agent 不建立静态一一映射。同一 Role 可以跨多个 Task 对共享子图负责。

## 怎么维护

- 本目录只保存：Role 定义、职责、可承担该 Role 的 Actor 类型
- **不保存**：Agent 定义、Role-Agent 映射、Prompt、Skill、Workflow、调度逻辑
- Human Gate 属于 Runtime/Governance Policy，不是 Role 固有属性
