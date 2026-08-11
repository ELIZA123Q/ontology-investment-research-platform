# 身份 — 动作是谁发起的

> 上级目录：[`05_control_evaluation/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里回答「动作是谁发起的」。好比操作日志里的操作人字段——记录每个动作是研究员、AI 助手还是系统自动发起的。

## 里面有什么

身份类型（`actorType`）有四种：

| 身份类型 | 说明 |
|---------|------|
| `researcher` | 研究员（人） |
| `agent` | AI 助手 |
| `system` | 系统自动 |
| `ontology_admin` | 本体管理员 |

## 三个概念不要混

| 概念 | 回答什么 | 在哪 |
|------|---------|------|
| **Identity（身份）** | 动作是谁发起的 | 本目录 |
| **Role（角色）** | 任务中的责任位置 | [`02_scenario_task/04_roles/`](../../02_scenario_task/04_roles/README.md) |
| **Permission（权限）** | 谁可以对什么资源做什么 | [`../03_permissions/`](../03_permissions/README.md) |

> 每个 Action 记录 `actorType` 和 `actorId`；审批记录另行保存批准主体——「谁发起」「谁批准」「允许做什么」分开记录。
