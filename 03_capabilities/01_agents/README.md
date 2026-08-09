# Agent 注册

这里登记产品 Agent 的治理视图，不保存第二份 Agent prompt。

- vNext.1 唯一活动 Agent：`research-lead`
- `evidence-investigator`、`analysis-specialist`、`independent-critic` 仅为 planned，不参与运行
- 可执行 manifest：`07_runtime/src/capabilities/registry.ts`
- Research Lead 始终保持用户对话控制权；内部节点执行不是 A2A handoff
