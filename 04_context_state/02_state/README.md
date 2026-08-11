# 状态 — 任务做到哪一步了

> 上级目录：[`04_context_state/`](../README.md) | 根目录：[`README.md`](../../README.md)

回答「这个任务现在进行到哪里」。好比项目进度看板——任务处于什么阶段、发生过什么事件、从哪里可以恢复。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `contract.yaml` | **合同**：状态怎么定义和管理的规则 |

## 三层分工

| 概念 | 回答什么 | 类比 |
|------|---------|------|
| **Event（事件）** | 发生过什么 | 工作日志 |
| **State（状态）** | 现在是什么 | 当前状态 |
| **Checkpoint（检查点）** | 从哪里继续 | 书签 |

## 怎么用

1. **查进度** → 读 State（或 Runtime 投影出的当前状态），不要靠翻聊天记录猜
2. **改状态字段或生命周期** → 先改合同，再改 Runtime
3. 本目录只放合同，**不放**运行中的 SQLite 或导出包

## 怎么维护

- 保持 Session → Task → Run 三层清晰
- **不要**把 Workspace 产物清单塞进 State
- **禁止**在本域实现第二套 Runtime

> 当前 Runtime 尚未物化独立的 SessionState/TaskState/RunState 表；合同是权威目标，现阶段通过已有运行对象投影满足一部分字段。不得把「可投影」写成「已经完整实现」。

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| 合同 | `contract.yaml` |
| 当前实现映射 | `06_runtime/src/runtime/store.ts`（Conversation/Task/RuntimeJob/Approval/Event/Checkpoint 投影） |
| status | active |
