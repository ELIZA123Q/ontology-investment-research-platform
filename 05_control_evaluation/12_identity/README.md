# 身份壳（identity）

说明「你是谁」：researcher / reviewer / system_job 等身份，以及与 Task 角色的映射。
登录实现尚未作为本目录重点（authentication deferred）。

## 给谁看

维护者；研究员一般不需要改这里。

## 材料从哪来

- 本目录 [`registry.yaml`](./registry.yaml)
- 角色说明另见 [`02_scenario_task/03_roles/`](../../02_scenario_task/03_roles/README.md)
- 权限细节见 [`../13_permissions/`](../13_permissions/README.md)

## 怎么用

查阅身份枚举与角色映射；不要把权限矩阵写进本目录。

## 怎么维护

- **status:** migrating
- 身份主数据变更同步 roles 与 permissions 壳，避免三处打架。

---

## 维护者附录（可跳过）

- **不放什么：** 权限矩阵细节、登录实现
