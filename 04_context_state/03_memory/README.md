# 记忆（Memory）

回答「跨任务以后还记住什么」：偏好、主题历史、已验证失败模式的可调用摘要。
**不是**把某一次 Judgment 当成永远正确的真理，也**不是**正式知识权威。

## 给谁看

- **研究员：** 了解系统可能记住哪些跨会话信息
- **维护者：** 读写规则与存储实现

## 材料从哪来

- **合同：** [`contract.yaml`](./contract.yaml)
- **实现：** `06_runtime/src/runtime/store.ts`（SQLite `memory_records`）
- **分工：** Memory = 跨任务体验优化；Knowledge / Method / Eval = 正式真理；Workspace = 本次产物

## 怎么用

1. 日常通过工作台使用；记忆写入由 Runtime 按规则执行。
2. 查阅允许写/读什么 → 读 `contract.yaml`。
3. `validated_failure_modes` 应带 `source_ref` 指向 Eval，不复制完整规则正文。

当前 Runtime 已有 `memory_records` 存储和三类 kind 约束；独立 `source_ref` / `freshness` 字段与 promotion 门仍未完整物化。

## 怎么维护

- 改 scopes/规则只改合同，并同步 Runtime 行为与测试。
- 禁止把 Workspace 单次产物或 Eval 全文直接提升为 Memory 真理。
- **status:** active
