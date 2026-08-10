# 记忆（Memory）

说明「跨任务可以记住什么」：偏好、主题历史、已验证的失败模式等。
**不是**把某一次 Judgment 当成永远正确的真理。

## 给谁看

- **研究员：** 了解系统可能记住哪些跨会话信息
- **维护者：** 读写规则与存储实现

## 材料从哪来

- 合同：[`contract.yaml`](./contract.yaml)（scopes / write_rules / read_rules）
- **可执行实现：** `06_runtime/src/runtime/store.ts`（SQLite `memory_records`）
- 与 Workspace 分工：Memory = 跨任务；Workspace = 本次产物，不得混写

## 怎么用

1. 日常通过工作台使用即可；记忆写入由 Runtime 按规则执行。
2. 查阅允许写/读什么 → 读 `contract.yaml`。
3. 不要期望未核验证据草稿、密钥、原始思维链进入 Memory。

## 怎么维护

- 改 scopes/规则只改合同，并同步 Runtime 行为与测试。
- 禁止把 Workspace 单次产物直接提升为长期真理。
- **status:** active

---

## 维护者附录（可跳过）

- **不放什么：** 单次 Judgment 当长期真理、未核验证据草稿、密钥、原始 CoT、未授权材料
