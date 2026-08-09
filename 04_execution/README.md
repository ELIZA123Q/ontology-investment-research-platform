# 执行状态域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

这里回答「这一次研究如何被记住与回放」：上下文合同、记忆合同、历史工作区样例，以及 Runtime 相关索引。

**真正跑任务的程序在 [`07_runtime/`](../07_runtime/README.md)**；本域多为合同、历史 Workspace 与迁移中的索引，不是第二套执行引擎。

## 给谁看

- **研究员**：偶尔查阅历史样例 / 回归包，了解某次研究留下了什么
- **维护者**：Context/Memory 合同与 Workspace 治理

## 材料从哪来

| 子目录 | 白话含义 |
|---|---|
| [`01_context/`](01_context/README.md) | 上下文如何装配的合同与说明 |
| [`02_memory/`](02_memory/README.md) | 记忆写入与读取边界 |
| [`03_workspace/`](03_workspace/README.md) | 历史运行样例、回归夹具 |
| [`04_runtime/`](04_runtime/README.md) | 指向现行 Runtime 的索引（实现不在此） |

## 怎么用

1. 要看**现行系统怎么跑** → 直接去 [`07_runtime/README.md`](../07_runtime/README.md)。
2. 要回放**历史研究产物** → 进 [`03_workspace/`](03_workspace/README.md)，按样例 README 阅读；把它们当「当时留下的快照」，不是现行规范。
3. 要改装配/记忆规则 → 先读对应合同目录，再与治理域合同对齐。

## 怎么维护

- 新的运行实现只进 `07_runtime/`。
- 本域新增合同或样例时更新 [`registry.yaml`](./registry.yaml)，并标明 status（多为 migrating）。
- 回归包保持可回放；不要把一次性聊天记录当成正式合同。

---

## 维护者附录（可跳过）

- **status:** migrating
- **上位:** [`00_五域系统骨架.md`](../05_governance/01_架构/00_五域系统骨架.md)
- Context / Memory / Workspace / Runtime 四者是执行侧面，不是四种业务知识库
