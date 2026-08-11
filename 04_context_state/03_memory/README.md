# 记忆 — 跨任务记住什么

> 上级目录：[`04_context_state/`](../README.md) | 根目录：[`README.md`](../../README.md)

回答「跨任务以后还记住什么」——偏好、主题历史、已验证失败模式的可调用摘要。好比研究员的工作笔记——记住某个行业通常怎么看、上次哪里踩过坑，但不会把某次判断当成永远正确的真理。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `contract.yaml` | **合同**：记忆的读写规则和存储策略 |

## 记住什么、不记住什么

| 记住 | 不记住 |
|------|--------|
| 研究偏好（比如喜欢看哪些指标） | 某次 Judgment 当永远正确的真理 |
| 主题历史摘要 | 正式知识权威（那是 01-05 的事） |
| 已验证的失败模式 | 单次研究的完整产物（那是 Workspace 的事） |

## 怎么用

1. 日常通过工作台使用，记忆写入由 Runtime 按规则自动执行
2. 查阅允许写/读什么 → 读 `contract.yaml`
3. `validated_failure_modes` 应带 `source_ref` 指向 Eval，不复制完整规则正文

## 怎么维护

- 改规则只改合同，并同步 Runtime 行为与测试
- **禁止**把 Workspace 单次产物或 Eval 全文直接提升为 Memory 真理

> 当前 Runtime 已有 `memory_records` 存储和三类 kind 约束；独立 `source_ref`/`freshness` 字段与 promotion 门仍未完整物化。

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| 合同 | `contract.yaml` |
| 实现 | `06_runtime/src/runtime/store.ts`（SQLite `memory_records`） |
| 分工 | Memory = 跨任务体验优化；Knowledge/Method/Eval = 正式真理；Workspace = 本次产物 |
| status | active |
