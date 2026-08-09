# 当前 Runtime 架构边界

## 五域只是后台职责

| 域 | vNext.1 落点 | 不做什么 |
|---|---|---|
| Semantic | `src/semantic/graph-contracts.ts` 和 Context Builder | 不建立万能图，不强制 Neo4j |
| Task | Intent、Task、受约束 TaskNode Catalog | 不允许 LLM 创建任意节点 |
| Capability | 5 个 Skill、Tool、Provider Adapter | 不把每个操作包装成 Skill |
| Execution | Event Log、关键 Checkpoint、Queue、Worker | 不做纯 Event Sourcing，不在 HTTP 中跑长任务 |
| Governance | 权限、provenance、可信 UI、Verifier | 不把确定性检查和质量 Eval 混为一谈 |

## Runtime 真相与投影

- Conversation、Task/TaskNode、Artifact、Approval、MemoryRecord 是可直接查询的业务状态，不要求每次从 Event 重放。
- Event 是追加式审计日志，也是 Message、Trace 和执行时间线的投影来源。
- ContextPackage 是单次调用装配结果；选择原因、引用版本和预算写入 Event。
- Checkpoint 是恢复技术对象，只在关键状态写入。
- 有副作用的 Tool 由 idempotency key 保证不重复执行；模型和只读 Tool 通过 fingerprint/cache 尽可能避免重复调用，但不承诺所有 Provider 绝不重复计费。

## 受约束规划

`src/runtime/node-catalog.ts` 是允许节点的白名单。Runtime 在执行前验证：

1. 节点类型存在且输出 Artifact 类型固定。
2. 前置状态满足，依赖节点完成。
3. Agent 具备该 Artifact 的写权限。
4. 未经 capture 的来源不能升级为 EvidenceFact。
5. 没有合格 Evidence 时 Claim 不能标记 supported，Judgment 必须降级。
6. 用户改变时间范围时走 impact analysis，明确复用与失效范围。

规划器负责从白名单中选最小路径、建立依赖和并行组。vNext.1 中模型未来可以提出节点组合，但最终图必须通过 Runtime 编译和验证。

## Agent 演进

- 当前：Research Lead + Skills + Tools + Verifiers。
- 下一阶段：仅在取证并行有评测收益时启用 Evidence Investigator，Research Lead 始终保持用户对话控制权。
- 后续：根据失败案例决定是否启用 Analysis Specialist、Independent Critic。

这是 manager-as-tools 模式，不做用户对话 handoff；内部任务约束也不伪装成 A2A。只有跨进程或第三方远程 Agent 才映射 A2A Task、Message 和 Artifact。

## 两张图

- Domain Semantic Graph：Company、Product、Technology、Industry、StateVariable、Event、InferenceRule 等稳定世界模型。
- Research Provenance Graph：Source → EvidenceFact → Claim → Judgment → Artifact，以及 Task → TaskNode → AgentRun。

两者可通过实体引用关联，但类型、版本与边语义分别治理。检索接口允许 FTS、vector、structured query、domain graph traversal 和 provenance graph traversal 混合选择。
