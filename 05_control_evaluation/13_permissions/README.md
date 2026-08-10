# 权限壳（permissions）

说明「你能做什么」的最小矩阵：表达强度、来源访问、人工门、Memory 写入资格等。
完整 RBAC 实现延期（`implementation: deferred_no_rbac`）。

## 给谁看

维护者；研究员按工作台实际权限门槛操作即可。

## 材料从哪来

- 本目录 [`registry.yaml`](./registry.yaml) 与最小矩阵资产
- 身份主数据见 [`../12_identity/`](../12_identity/README.md)

## 怎么用

查某类操作是否被允许时读本目录矩阵；不要在此做评测打分或身份主数据维护。

## 怎么维护

- **status:** migrating
- 变更需与 Runtime 实际权限行为对照，避免「文档允可、系统不允许」。

---

## 维护者附录（可跳过）

- **不放什么：** 身份主数据、评测打分、完整 RBAC 实现
