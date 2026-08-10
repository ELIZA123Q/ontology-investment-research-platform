# 上下文（Context）

说明「这一刻模型被允许看见什么」：上下文是按任务临时组装的，不是一本长期知识全书。

## 给谁看

- **研究员：** 理解系统不会把所有历史一股脑塞进对话
- **维护者：** Context 合同与 Runtime 装配实现

## 材料从哪来

- 合同/登记：本目录 [`registry.yaml`](./registry.yaml)
- **权威实现：** `06_runtime/src/runtime/kernel.ts`（`ContextPackage`）
- 不放长期方法正文、正式本体权威副本、跨任务 Memory

## 怎么用

1. 日常无需手工维护 Context 目录。
2. 想了解装配原则 → 读本目录合同说明，再对照 Runtime。
3. ContextPackage 是单次调用临时对象，不会建成独立「Context 中心」仓库。

## 怎么维护

- 规则变更优先改合同与 Runtime 实现，保持一致。
- 禁止把跨任务 Memory 或方法库正文塞进 Context 目录。
- **status:** active

---

## 维护者附录（可跳过）

- 装配结果可以 Event Manifest 留痕；对象本身仍是临时的
