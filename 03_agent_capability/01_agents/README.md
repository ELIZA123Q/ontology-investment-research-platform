# AI 助手名册 — 谁来做研究

> 上级目录：[`03_agent_capability/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里登记系统里有哪些 AI 助手（Agent）、各自职责和状态。好比团队的花名册——谁已经上岗、谁还在候选。

## 里面有什么

| 状态 | Agent | 说明 |
|------|-------|------|
| **正式上线** | [`research_lead/`](research_lead/README.md) | 唯一当前可调度的 Agent |
| 候选（不调度） | evidence-investigator | 证据调查员，待激活 |
| 候选（不调度） | financial_modeler | 财务建模师，待激活 |
| 候选（不调度） | independent-critic | 独立批评者，待激活 |
| 候选（不调度） | analysis-specialist | 分析专家，待评测增益证明后启用 |

## Role 和 Agent 的关系

```
Role  = 任务责任位（02_scenario_task/04_roles/）——需要有人对什么负责
Agent = 能承担该责任位的运行主体（本目录）——谁来做
```

> 候选 Agent 在对应 Role 建立前，`can_assume_roles` 为空，不会为了凑字段而冒充 Research Lead。

## 怎么维护

- 定义改本目录；启用/停用的执行绑定改 `06_runtime/src/capabilities/registry.ts`
- 内部节点执行不是 A2A handoff
- **禁止**在本目录复制 AGENT.md prompt 正文

## 常见问题

**Q：为什么只有一个 Agent 上线？**
A：首期以责任与权限拆分，不按价值/成长/多空等风格拆分。Research Lead 负责研究组织、协调与判断综合。其他角色待复杂推理评测证明增益后再启用。

**Q：研究视角和交付文风由什么控制？**
A：研究视角由 `research_lens` 组合控制，交付文风由 `expression preset` 控制——二者都不是 Agent。
