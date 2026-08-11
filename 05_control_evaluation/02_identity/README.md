# Identity

这里回答「动作是谁发起的」。Identity 使用 Runtime 的 `actorType` 与 `actorId`，不等同于任务责任 Role，也不等同于权限。

`actorType` 是 `researcher`、`agent`、`system` 或 `ontology_admin`。任务责任位仍由 [`02_scenario_task/04_roles/`](../../02_scenario_task/04_roles/README.md) 定义，具体允许的动作见 [`../03_permissions/`](../03_permissions/README.md)。

每个 Action 记录 `actorType` 与 `actorId`；审批记录另行保存批准主体，从而把「谁发起」「谁批准」「允许做什么」分开。
