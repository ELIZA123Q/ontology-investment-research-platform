# Agent 登记

这里登记产品里有哪些 Agent、各自职责与状态（活动 / 计划中）。**不保存第二份 Agent 提示词或实现代码。**

## 给谁看

- **研究员：** 知道当前主要对话对象是 Research Lead
- **维护者：** 治理视图与 Runtime 可执行清单对齐

## 材料从哪来

- 本目录治理登记（含 registry）
- **唯一可执行 manifest：** `07_runtime/src/capabilities/registry.ts`

## 怎么用

1. 日常：只与 Research Lead 对话即可。
2. 查阅谁已启用 / 谁仍是 planned → 看本目录说明，并以 Runtime registry 为准。
3. 当前活动 Agent：`research-lead`。`evidence-investigator`、`analysis-specialist`、`independent-critic` 仅为 planned，不参与运行。

## 怎么维护

- 治理说明改本目录；真正启用/停用必须改 Runtime registry，并跑测试与 `audit-cutover`。
- Research Lead 保持用户对话控制权；内部节点执行不是 A2A handoff。

---

## 维护者附录（可跳过）

- 本域不镜像 prompt；禁止 planned Agent 被调度运行
