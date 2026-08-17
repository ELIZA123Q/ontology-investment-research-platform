# 当前 Runtime 架构边界

## 模块单体与依赖方向

`@investment/domain` 是无 IO 的稳定领域边界；`@investment/knowledge` 编译和装载不可变知识包；`@investment/orchestrator` 只处理 WorkOrder、ArtifactEnvelope、预算和 Agent 权限；`@investment/persistence-sqlite` 与 `@investment/adapters` 实现端口；Next.js Workbench 只能从 `src/application` 进入。`npm run audit:architecture` 阻止反向依赖、跨包深层导入和公共 API 直连旧执行实现。

01-05 仍是编辑权威，但 Runtime 不把可变 YAML 当作运行输入。编译器生成内容寻址的 `manifest.json`、`bundle.json` 和资产索引；ResearchRun 锁定 bundle ID。批准的知识 Release 会物化为作用域内派生 bundle，未发布候选对后续上下文不可见。

## 五域只是后台职责

| 域 | vNext.1 落点 | 不做什么 |
|---|---|---|
| Semantic | `src/semantic/graph-contracts.ts` 和 Context Builder | 不建立万能图，不强制 Neo4j |
| Task | Intent、Task、受约束 TaskNode Catalog | 不允许 LLM 创建任意节点 |
| Capability | 03 定义的 12 个 Skill（当前 5 active、7 candidate）、Tool、Provider Adapter | 不把每个操作包装成 Skill |
| Execution | Event Log、关键 Checkpoint、Queue、Worker | 不做纯 Event Sourcing，不在 HTTP 中跑长任务 |
| Governance | 权限、provenance、可信 UI、Verifier | 不把确定性检查和质量 Eval 混为一谈 |

## Runtime 真相与投影

- Conversation、Task/TaskNode、Artifact、Approval、MemoryRecord 是可直接查询的业务状态，不要求每次从 Event 重放。
- Event 是追加式审计日志，也是 Message、Trace 和执行时间线的投影来源。
- Artifact、Approval 与 Event 的持久化由 `SqliteResearchRecordRepository` 统一管理，确保制品修订、审批失效和审计事件共享同一事务边界；`RuntimeStore` 不再拥有这些表的 SQL。
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

规划器从已物化的 Research Problem Graph frontier 编译最小可执行路径，并消费 02 的 Workflow Pattern 与 Scenario 生命周期约束。模型可提出预算、停止条件和路径先验，最终节点仍由问题图编译器重绑 frontier 并通过确定性验证。

生产首页的 `earnings_update` 使用专用编译器：初始图最多 15 个节点；`company_coverage` 即使在 evaluation 范围也最多 25 个节点。范围作为输入，独立复核/审计与报告作为终端，不再对每个方法论单元机械生成三套取证流水线；节点预算之和不得超过 Task 预算。

## Agent 演进

- 当前产品兼容链路仍由 Research Lead 控制；新增执行不得扩张旧 Kernel。
- 生产 worker 只依赖 Application Worker Port，架构审计阻止入口重新导入 Kernel、Store、Provider 或 Knowledge Service。
- 业绩更新黄金链路已启用受约束的 Evidence Investigator、Financial Modeler 和 Independent Critic，worker 不能直接写数据库或改变任务状态。
- 只有黄金回放与激活评测持续通过后，worker 才能从 evaluation 扩展到生产自动调度。

这是 manager-as-tools 模式，不做用户对话 handoff；内部任务约束也不伪装成 A2A。只有跨进程或第三方远程 Agent 才映射 A2A Task、Message 和 Artifact。

## 两张图 + 一条执行迹

- Domain Semantic Graph：Company、Product、Technology、Industry、StateVariable 等稳定世界模型。
- Research Provenance Graph：SourceDocument → EvidenceFact → EvidenceClaim → Signal → Hypothesis → Judgment → ReasoningTrace（Artifact 仅作 provenance reference）。
- Execution Trace：Task → TaskNode → AgentRun，以及 Event / Checkpoint——归 Runtime Execution，**不**并入 Knowledge Graph。

前两者可通过实体引用关联，但类型、版本与边语义分别治理；也不与 Execution Trace 混成万能图。检索接口允许 FTS、vector、structured query、domain graph traversal 和 provenance graph traversal 混合选择。

Context Builder 当前会物化 `OntologyContextSlice`，显式携带对象、一步关系路径、有效时间和来源版本引用；词法/FTS 资产命中仍作为并行输入，而不再冒充本体遍历。外部 `source.query` 首个生产适配器为巨潮公开公告查询，统一经过截止日、权限、哈希、失败回退和熔断边界。
