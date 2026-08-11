# Permissions

这里回答「谁可以对什么资源做什么」。全局不可绕过的权限边界写在本目录；每个 Action 的具体 `allowed_actors` 与 `approval_policy` 由 Ontology 4.0 Action Catalog 承载并由 Runtime 执行。

规则本身（例如不得伪造来源、不得绕过独立评测门）属于 [`../01_rules/`](../01_rules/README.md)，不是权限。身份枚举属于 [`../02_identity/`](../02_identity/README.md)，任务责任位属于 `02_scenario_task/04_roles/`。

本目录的 [`permission_matrix.yaml`](permission_matrix.yaml) 只登记跨 Action 的不变量，不复制每个 Action 的允许列表。
