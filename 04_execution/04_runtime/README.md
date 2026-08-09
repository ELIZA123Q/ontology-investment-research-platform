# Runtime 索引（执行域壳）

本目录只回答「真正负责运行的代码在哪」，**不存放**业务语义或方法正文。可执行实现一律在 [`07_runtime/`](../../07_runtime/README.md)。

## 给谁看

维护者与开发者；研究员请直接看 `07_runtime` README。

## 材料从哪来

- 权威实现：`07_runtime/src/runtime/`、`07_runtime/src/worker.ts`、`07_runtime/app/`
- 本目录 [`registry.yaml`](./registry.yaml) 仅作索引/兼容登记

## 怎么用

1. 启动、开发、调试 → 跟 [`07_runtime/README.md`](../../07_runtime/README.md) 走。
2. 本目录没有第二套 kernel。

## 怎么维护

- 不在本目录新增实现代码。
- 索引变更时更新 registry，保持指向 `07_runtime`。
- **status:** active

---

## 维护者附录（可跳过）

- **回答什么：** 谁负责真正运行（kernel/event/checkpoint/queue/worker/app）
- **不放什么：** 业务语义定义、研究员可读方法正文
