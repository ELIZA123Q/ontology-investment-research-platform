# 04_execution/02_memory

- **回答什么：** 跨任务可保留什么（偏好、主题历史、已验证失败模式）。
- **不放什么：** 单次 Judgment 当长期真理、未核验证据草稿、密钥、原始 CoT、未授权材料。
- **当前权威资产：** [`contract.yaml`](./contract.yaml)（scopes / write_rules / read_rules）。
- **status:** active（SQLite `memory_records` 已实现）
- **与 Workspace：** Memory=跨任务；Workspace=`04_execution/03_workspace/` 本次产物。不得混写。
- **可执行实现：** `07_runtime/src/runtime/store.ts`
