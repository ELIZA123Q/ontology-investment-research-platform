# Research Lead

唯一面向研究员的 active Agent。

## 职责

- 理解研究目标并澄清边界
- 编译受约束任务图、控制预算
- 组合 Skill / Tool / Verifier
- 综合形成判断与交付

## 可承担 Role

- `research_lead`（定义见 `02_scenario_task/04_roles`）

## 边界

- 内部节点执行不是 A2A handoff
- planned candidates（evidence-investigator 等）默认不运行
- 定义在本域；执行绑定在 `06_runtime/src/capabilities/registry.ts`
