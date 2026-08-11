# Identity

这里回答「动作是谁发起的」。Identity 由执行主体类别和 Persona 组成，不等同于任务中的 Role，也不等同于权限。

`principal_type` 是 `human`、`agent` 或 `system_job`；`persona` 可为 `researcher`、`reviewer` 或 `ontology_admin`。任务责任位仍由 [`02_scenario_task/04_roles/`](../../02_scenario_task/04_roles/README.md) 定义，具体允许的动作见 [`../03_permissions/`](../03_permissions/README.md)。

每个 Action 或批准记录 `principal_type`、`principal_id`、`persona` 与可选的 `role_id`，从而把「谁」「本次承担什么责任」「能做什么」分开。
