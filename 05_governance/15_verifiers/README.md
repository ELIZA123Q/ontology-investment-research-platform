# Verifier 壳（verifiers）

说明「确定性条件是否满足」：schema、来源、回溯、门槛字段等机器可判定项。
研究洞察好不好、有没有流程增益，不在这里打分（那是 evals）。

## 给谁看

维护者；研究员更常直接用 [`../03_校验/`](../03_校验/README.md) 的脚本与 `00A`。

## 材料从哪来

- **当前权威实现/脚本：** [`../03_校验/`](../03_校验/README.md)
- Runtime Verifier 代码：`07_runtime/src/governance/`
- 本目录 [`registry.yaml`](./registry.yaml) 为迁移壳入口

## 怎么用

跑结构/来源类检查 → 用校验目录脚本；查「Verifier 壳登记」→ 本目录 registry。

## 怎么维护

- **status:** migrating
- 新确定性检查优先落入 `03_校验` 与 Runtime verifiers，本壳只同步入口。

---

## 维护者附录（可跳过）

- **不放什么：** 研究洞察打分、流程增益宣称
