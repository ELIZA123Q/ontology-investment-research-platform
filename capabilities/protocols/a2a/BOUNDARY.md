# A2A Protocol Boundary

status: shell（未实现）  
registry: [`registry.yaml`](./registry.yaml)

## 回答什么

多 Agent 协作时如何交接意图、上下文与结果边界。

## 最小消息外形（草案，非实现）

```text
A2AMessage
  intent:        Task / 子目标
  identity:      researcher | reviewer | system_job | agent_id
  context_refs:  Context 切片引用（非整库）
  capability_requests: Skill/Tool 请求
  workspace_writes: 允许写入的 Workspace 对象类型
  governance_constraints: Rules/Permissions/Verifier 约束引用
  result_envelope: 结构化结果 + 追溯 ID
```

## 当前不做

- 不实现假协议代码或网络传输层
- 不对外宣称 A2A 已上线
- 不把 Deep Research 01–05 编排伪装成 A2A
- 不让 Agent 之间互相改写对方已批准的 Judgment

## 与现系统关系

| 现能力 | 是否算 A2A |
|--------|------------|
| Deep Research 阶段编排（controller） | 否（确定性 Workflow） |
| producer / reviewer 分离 | 否（角色门，非对等 Agent 协议） |
| MCP 工具调用 | 否（Tool 协议） |

## 何时启用

同时满足：

1. 存在真实跨 Agent 协作需求（非同进程阶段接力）
2. Task / Capability / Execution / Governance 入口层已稳定（wave0–4）
3. 有可回放的交接契约与 Verifier 门

然后才补协议草案实现，不得先写“看起来像 A2A”的空壳代码。
