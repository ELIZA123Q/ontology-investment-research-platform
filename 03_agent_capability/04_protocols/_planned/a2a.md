# A2A（planned）

> 状态：roadmap / planned。当前正式协议层只保留 MCP。
> 在未出现真实跨 Agent handoff（Research Lead → Evidence Investigator → result envelope）前，不要把 A2A 当作与 MCP 同等成熟的协议。

## 为什么现在不进正式结构

- 唯一 active Agent 是 `research-lead`
- evidence-investigator / analysis-specialist / independent-critic 仍是 candidates
- 当前 Workflow、producer/reviewer、MCP 都不属于 A2A
- 仓库里没有生产级 A2A 实现；默认不要依赖

## 启用门槛

当且仅当出现真实跨进程 / 第三方远程 Agent 协作，并且需要标准 handoff / result envelope 时，再把本文件提升为 `04_protocols/a2a/`。

## 原边界摘要

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


## 原 registry（冻结）

```yaml
schema_name: capability_a2a_protocol_registry
schema_version: 1.0.0
status: shell

authority:
  answers: A2A 仅边界与启用条件；未实现。
  write_entry: 03_agent_capability/04_protocols/_planned/
  read_primary:
    - 03_agent_capability/04_protocols/_planned/BOUNDARY.md
    - 03_agent_capability/04_protocols/_planned/registry.yaml

implementation_allowed: false
boundary_doc: 03_agent_capability/04_protocols/_planned/BOUNDARY.md

forbidden_until_enabled:
  - network_a2a_transport
  - fake_peer_agent_stubs
  - claiming_a2a_production_ready
  - treating_deep_research_stages_as_a2a

enable_when:
  - real_multi_agent_collaboration_needed
  - five_domain_entry_layer_stable
  - replayable_handoff_contract_exists

notes:
  - wave5: 边界契约已冻结；禁止假实现。

```

## 原 README（冻结）

# A2A 协议边界

Agent-to-Agent（智能体之间）协作协议的边界说明。当前**没有**已验证的生产实现，目录多为占位与边界声明。

## 给谁看

- **维护者：** 防止误把未实现协议当成可用能力
- **研究员：** 通常可跳过

## 材料从哪来

- 边界说明见本目录 `BOUNDARY.md`（若存在）及本 README
- 现行产品对话控制权始终在 Research Lead，内部节点执行不是 A2A handoff

## 怎么用

1. 默认不要依赖 A2A。
2. 需要多角色能力时，以 Runtime 已启用 Agent 为准（当前仅 Research Lead）。
3. 查阅边界文档，确认「未实现」状态，避免对接虚构接口。

## 怎么维护

- 在有可验证实现之前保持 `shell`，不提交假协议实现。
- 若未来落地，需同步 Runtime、治理合同与评测，不得只写文档宣称可用。

---

## 维护者附录（可跳过）

- **status:** shell（未实现）
- **当前权威资产：** 无生产实现

