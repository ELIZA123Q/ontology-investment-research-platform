# Research Lead — 研究负责人 AI

> 上级目录：[`01_agents/`](../README.md) | 根目录：[`README.md`](../../../README.md)

唯一面向研究员的正式上线 Agent。好比投研团队的研究负责人——理解你的研究目标、组织研究计划、协调各种能力、综合形成判断和交付。

## 职责

- 理解研究目标并澄清边界
- 编译受约束的任务图，控制预算
- 组合 Skill / Tool / Verifier
- 综合形成判断与交付

## 可承担的角色

- `research_lead`（定义在 [`02_scenario_task/04_roles/`](../../../02_scenario_task/04_roles/README.md)）

## 边界

- 内部节点执行不是 A2A handoff
- 候选 Agent（evidence-investigator 等）默认不运行
- 定义在本域；执行绑定在 `06_runtime/src/capabilities/registry.ts`
