# 上下文 — 这一次 AI 能看见什么

> 上级目录：[`04_context_state/`](../README.md) | 根目录：[`README.md`](../../README.md)

回答「这一次 AI 调用时能看见哪些信息」。上下文是按任务动态组装的临时视图——用完即弃，不是长期知识库。好比开会时手边的资料：每次开会带不同的材料，开完就收起来。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `contract.yaml` | **合同**：上下文怎么组装的规则（本域权威） |

## 怎么用

1. 日常无需手工维护——Runtime 按规则自动组装
2. 改组装规则 → 先改 `contract.yaml`，再改 Runtime
3. ContextPackage 是单次调用临时对象，**不建成**「Context 中心」仓库

## 怎么维护

- 合同优先于实现描述
- **禁止**把跨任务 Memory 或 Skill references 正文塞进 Context 目录
- 当前 Runtime 已实现引用清单、Knowledge Lock、版本/新鲜度和 token budget 留痕；`state/workspace/memory/capabilities/policies` 的显式分段仍是待对齐项

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| 合同 | `contract.yaml`（本域权威） |
| 实现 | `06_runtime/src/runtime/kernel.ts`（装配）、`06_runtime/src/contracts.ts#ContextPackage`（类型绑定） |
| status | active |
