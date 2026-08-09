# 研究角色

这里说明「人」与「Research Lead」各自负责什么、哪些关键点必须人工确认。它不是模型厂商配置，也不是一次审批流水账。

## 给谁看

- **研究员**：知道自己要盯哪些门（计划确认、关键判断审阅等）
- **维护者**：角色登记与 Agent 清单对齐

## 材料从哪来

- 本目录 [`registry.yaml`](./registry.yaml)
- Agent 治理登记：[`03_capabilities/01_agents/`](../../03_capabilities/01_agents/README.md)
- 可执行 Agent 清单：`07_runtime/src/capabilities/registry.ts`（当前仅 `research-lead` 活动）

## 怎么用

1. 日常研究：你提出目标与材料，Research Lead 规划并执行，关键节点等你确认。
2. 不要期待「五个阶段五个 Agent」——现行版本不会这样跑。
3. 内部节点执行不是把对话控制权交给另一个 Agent。

## 怎么维护

- 改角色职责时同步更新本目录 registry 与能力域 Agent 说明。
- 若启用新 Agent，必须先改 Runtime manifest，且不得绕过「仅 planned 不运行」的约束，除非产品明确升版。
- **status:** active

---

## 维护者附录（可跳过）

- vNext.1 不再把五阶段角色映射成五个 Agent
- **不放什么：** 模型 provider 配置、单次审批记录、本体类型定义
