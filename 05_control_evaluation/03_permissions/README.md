# 权限 — 谁可以对什么资源做什么

> 上级目录：[`05_control_evaluation/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里定义全局不可绕过的权限边界。好比系统的门禁系统——谁有权限进哪个门、操作哪个资源。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `permission_matrix.yaml` | **权限矩阵**：跨 Action 的不变量（不复制每个 Action 的允许列表） |

## 三个概念不要混

| 概念 | 回答什么 | 在哪 |
|------|---------|------|
| **规则** | 什么必须遵守（如不得伪造来源） | [`../01_rules/`](../01_rules/README.md) |
| **身份** | 动作是谁发起的 | [`../02_identity/`](../02_identity/README.md) |
| **权限** | 谁可以对什么资源做什么 | 本目录 |

> 每个 Action 的具体 `allowed_actors` 和 `approval_policy` 由 Ontology Action Catalog 承载，由 Runtime 执行。本目录只登记跨 Action 的不变量。
