# 状态（State）

回答「这个任务现在进行到哪里」：运行实例的当前状态，不是 Task 定义，也不是聊天记录推断。

## 给谁看

- **研究员：** 理解暂停 / 继续 / 交接的依据是什么
- **维护者：** State 合同与 Runtime 持久化 / Checkpoint 对齐

## 材料从哪来

- **合同：** [`contract.yaml`](./contract.yaml)
- **当前实现映射：** `06_runtime/src/runtime/store.ts`（Conversation / Task / RuntimeJob / Approval / Event / Checkpoint 投影）
- **分工：** Event = 发生过什么；State = 现在是什么；Checkpoint = 恢复快照

## 怎么用

1. 查进度 → 读 State（或 Runtime 投影出的当前状态），不要靠翻聊天记录猜。
2. 改状态字段 / 生命周期 → 先改合同，再改 Runtime。
3. 本目录只放合同，不放运行中的 SQLite 或导出包。

当前 Runtime 尚未物化独立的 SessionState / TaskState / RunState 表；合同是权威目标，现阶段通过已有运行对象投影满足一部分字段。不得把“可投影”写成“已经完整实现”。

## 怎么维护

- 保持 Session → Task → Run 三层清晰；不要把 Workspace 产物清单塞进 State。
- 禁止在本域实现第二套 Runtime。
- **status:** active
