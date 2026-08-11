# 上下文与状态域 — 系统工作时看见什么、记住什么

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

这里管理 AI 助手工作时的「运行连续性」——当前看见什么信息、任务做到哪一步了、跨任务记住什么、正在操作什么东西。好比研究员工作时的「桌面状态」：桌上摊开哪些资料、笔记翻到哪页、上次研究到哪了。

**只定义规则**，不负责实际执行——所有执行由 [`06_runtime/`](../06_runtime/README.md) 实现。

## 里面有什么

| 子目录 | 一句话说明 | 你需要管吗 |
|--------|-----------|-----------|
| [`01_context/`](01_context/README.md) | **当前看见什么**：这一次 AI 调用时能看见哪些信息（临时组装，用完即弃） | 一般不用管 |
| [`02_state/`](02_state/README.md) | **做到哪了**：任务现在的状态、发生过什么事件、从哪里恢复 | 一般不用管 |
| [`03_memory/`](03_memory/README.md) | **记住什么**：跨任务记住的偏好、历史、失败模式 | 改记忆策略时看 |
| [`04_workspace/`](04_workspace/README.md) | **正在操作什么**：这一次任务的工作环境（文件存在 `06_runtime/.data/`） | 一般不用管 |

## 日常怎么用

- **要看系统怎么跑** → 去 [`06_runtime/README.md`](../06_runtime/README.md)
- **要改运行规则** → 先改对应子目录的 `contract.yaml`，再同步 Runtime

## 怎么维护

- 新的运行实现只进 `06_runtime/`，本域不放运行时代码
- 合同变更时更新 [`registry.yaml`](registry.yaml)
- **禁止把本机 SQLite 数据库文件塞回本域**

## 常见问题

**Q：Context 和 State 有什么区别？**
A：Context 是「这一次 AI 调用看见什么」（临时组装，用完就扔）。State 是「这个任务现在什么状态」（持久保存，随时可查）。好比 Context 是你这次开会时手边的资料，State 是项目的整体进度记录。

**Q：Memory 会把判断当真理记住吗？**
A：不会。Memory 只记住偏好、历史和失败模式，不会把某次 Judgment 当永远正确的真理，也不是正式知识权威。

**Q：Event、State、Checkpoint 什么关系？**
A：Event 记录「发生过什么」（日志），State 描述「现在是什么」（当前状态），Checkpoint 是「从哪里继续」（恢复快照）。三层分工明确。

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| status | active |
| 上位 | [`README.md`](../README.md) 与 [`06_runtime/ARCHITECTURE.md`](../06_runtime/ARCHITECTURE.md) |

### 核心概念

- Context / State / Memory / Workspace 是连续性侧面，不是四种业务知识库
- Event 记录发生过什么；State 描述现在是什么；Checkpoint 是 Runtime 恢复手段
- ContextPackage 是单次调用临时对象，不建成「Context 中心」仓库
- 物理存储在 `06_runtime/.data/`（由 Runtime 管理，不入 Git）
