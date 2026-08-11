# Permissions

这里回答「谁可以对什么资源做什么」。唯一的权限表达式是：`主体 × 资源 × 动作 × allow/deny`。

规则本身（例如不得伪造来源、不得绕过独立评测门）属于 [`../01_rules/`](../01_rules/README.md)，不是权限。身份枚举属于 [`../02_identity/`](../02_identity/README.md)，任务责任位属于 `02_scenario_task/04_roles/`。

本目录的 [`permission_matrix.yaml`](permission_matrix.yaml) 是最小政策矩阵；它不实现完整 RBAC。
