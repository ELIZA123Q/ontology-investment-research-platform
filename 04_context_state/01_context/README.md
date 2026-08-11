# 上下文（Context）

回答「这一次模型能看见什么」：按任务动态组装的临时视图，不是长期知识库。

## 给谁看

- **研究员：** 理解系统不会把所有历史一股脑塞进对话
- **维护者：** Context 合同与 Runtime 装配实现对齐

## 材料从哪来

- **合同：** [`contract.yaml`](./contract.yaml)（本域权威）
- **实现：** `06_runtime/src/runtime/kernel.ts`（装配）、`06_runtime/src/contracts.ts#ContextPackage`（类型绑定）
- 不放长期方法正文、正式本体权威副本、跨任务 Memory 正文

## 怎么用

1. 日常无需手工维护 Context 目录。
2. 改装配规则 → 先改 `contract.yaml`，再改 Runtime。
3. ContextPackage 是单次调用临时对象；可经 Event 留痕，不建成「Context 中心」仓库。

当前 Runtime 已实现引用清单、Knowledge Lock、版本/新鲜度和 token budget 留痕；`state / workspace / memory / capabilities / policies` 的显式分段仍是待对齐项。

## 怎么维护

- 合同优先于实现描述；禁止把 Runtime 现状反向写成唯一规范而不更新合同。
- 禁止把跨任务 Memory 或 Skill references 正文塞进 Context 目录。
- **status:** active
