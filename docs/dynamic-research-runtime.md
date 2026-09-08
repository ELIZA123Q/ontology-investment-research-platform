# 动态研究运行架构

## 边界

语义本体只保存稳定类型、属性、关系、词表和语义约束。证据与判断合同描述运行对象；规则决定条件和结果；Logic 提供实现目标的候选能力图。任何运行对象进入 RDF 图，都不会因此成为本体类。

## 从任务到执行

1. `ResearchPlanningService.propose()` 根据任务与当前图状态选择登记过的 Logic，并可接收 AI 产生的受限计划提案。
2. `ExecutionPlanCompiler.compile()` 校验能力版本、类型契约、依赖无环、写权限、正式事实与判断门槛、发布审批和目标可达性。
3. 编译结果是不可变 `ExecutionPlan`；调整产生带 `supersedes` 的 `PlanRevision`。
4. `ResearchOrchestrator` 从权威图恢复已完成节点，执行所有依赖满足的节点，并在节点边界重新评价运行规则。
5. `SemanticaPipelineAdapter` 把当次就绪层映射为一次性 Pipeline；恢复依据始终是 Oxigraph 中的计划、尝试、结果与审批记录。
6. 完成由 Logic 的完成规则和目标类型共同确定，不依赖固定步骤数。

无证据、已有合格证据、存在冲突和只做资料入库，会编译成不同节点数量和依赖的 DAG。多个安全节点可并行，证据不足则触发补证或判断等级上限。

## 审计

每个执行节点记录：

- 由哪些路由或激活规则选中；
- 调用哪个版本的 Capability；
- 声明读取和写入哪些对象类型；
- 每次尝试是成功还是失败；
- 结果由哪些输入和哪个活动产生；
- 哪条完成或阻断规则使计划结束。

来源、主张、事实、判断和报告观点映射为 `prov:Entity`；采集、抽取、规则评价、能力执行和报告生成映射为 `prov:Activity`；研究员、来源机构、模型和程序映射为 `prov:Agent`。

## Semantica 使用边界

项目固定 `semantica[shacl,tripletstore-oxigraph]==0.6.8`。具体类型只出现在 `src/ir_platform/adapters/semantica.py`：

- Oxigraph 持久化 RDF named graph；
- ContextGraph 提供进程内查询和遍历读模型；
- ProvenanceManager 保存追加式 SQLite 审计；
- PipelineBuilder 与 ExecutionEngine 执行当前就绪层。

通用 Decision 不替代投研 Judgment；图分析、相似度、向量检索和 GraphRAG 只能提供候选查询信号，不能提高判断等级。
