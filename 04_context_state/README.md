# 上下文与状态域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

管理 Agent 运行过程中「当前看见什么、当前处于什么状态、跨任务记住什么、当前工作环境包含什么」。本域定义运行连续性相关合同，**不承担实际执行**；所有执行、事件处理、状态迁移与持久化由 [`06_runtime/`](../06_runtime/README.md) 实现。

## 给谁看

- **研究员**：理解系统如何保持连续工作（进度、记忆边界、工作产物归属）
- **维护者**：Context / State / Memory / Workspace 合同与 Runtime 实现对齐

## 材料从哪来

| 子目录 | 一句话回答 |
|---|---|
| [`01_context/`](01_context/README.md) | 这一次模型能看见什么？ |
| [`02_state/`](02_state/README.md) | 这个任务现在进行到哪里？ |
| [`03_memory/`](03_memory/README.md) | 跨任务以后还记住什么？ |
| [`04_workspace/`](04_workspace/README.md) | 这一次任务正在操作什么东西？ |

## 怎么用

1. 要看**现行系统怎么跑** → [`06_runtime/README.md`](../06_runtime/README.md)。
2. 要改装配 / 状态 / 记忆 / 工作区规则 → 先改对应 `contract.yaml`，再同步 Runtime。
3. 历史示范案例 → [`05_control_evaluation/04_verifiers/fixtures/reference_runs/research_runs/`](../05_control_evaluation/04_verifiers/fixtures/reference_runs/research_runs/README.md)；回归夹具 → [`05_control_evaluation/04_verifiers/fixtures/regression/`](../05_control_evaluation/04_verifiers/fixtures/regression/README.md)。二者都不是 Workspace。

## 怎么维护

- 新的运行实现只进 `06_runtime/`；本域不放 Runtime 索引目录。
- 合同变更时更新 [`registry.yaml`](./registry.yaml)，并保持与 `06_runtime` 实现一致。
- 禁止把历史样例、回归夹具、本机 SQLite 重新塞回本域。

---

## 维护者附录（可跳过）

- **status:** active
- **上位:** [`00_五域系统骨架.md`](../docs/architecture/00_五域系统骨架.md)
- Context / State / Memory / Workspace 是连续性侧面，不是四种业务知识库
- Event 记录发生过什么；State 描述现在是什么；Checkpoint 是 Runtime 恢复手段
