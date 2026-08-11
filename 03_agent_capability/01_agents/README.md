# Agent 登记

这里登记产品里有哪些 Agent、各自职责与状态。**不保存第二份 Agent 提示词或实现代码。**

## 给谁看

- **研究员：** 知道当前主要对话对象是 Research Lead
- **维护者：** 能力定义与 Runtime 执行绑定对齐

## 现行

| 状态 | Agent |
|---|---|
| **active** | [`research_lead/`](research_lead/README.md) |
| **candidates（planned，不调度）** | evidence-investigator、analysis-specialist、independent-critic |

## 关系

```text
Role  = 任务责任位（02_scenario_task/04_roles）
Agent = 能承担该责任位的运行主体（本目录）
```

candidates 在对应 Role 建立前，`can_assume_roles` 为空，不为了 schema 去冒充 `research_lead`。

## 维护

- 定义改本目录；启用/停用的执行绑定改 `06_runtime/src/capabilities/registry.ts`
- 内部节点执行不是 A2A handoff
- 禁止在本目录复制 AGENT.md prompt 正文
## 责任拆分

首期以责任与权限拆分，不按价值/成长/多空等风格拆分：Research Lead、Evidence Investigator、Financial Modeler、Independent Critic。

研究视角由 research_lens 组合，交付文风由 expression preset 控制；二者都不是 Agent。分析风格类 analysis-specialist 保持 planned，待复杂推理评测证明增益后再启用。
