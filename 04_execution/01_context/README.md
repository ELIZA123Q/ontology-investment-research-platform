# 04_execution/01_context

- **回答什么：** 这一刻模型看见什么（动态组装）。
- **不放什么：** 长期方法正文、正式本体权威副本、跨任务 Memory。
- **当前权威实现：** `07_runtime/src/runtime/kernel.ts`；合同为 `ContextPackage`。
- **status:** active
- **registry:** [`registry.yaml`](./registry.yaml)

ContextPackage 是单次调用临时对象，不再建设独立 Context 中心或正文仓库。
