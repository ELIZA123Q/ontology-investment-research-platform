---
doc_status: active
version: 1.1.0
authority: knowledge_learning_architecture
owners:
  - governance_owner
  - ontology_steward
  - method_owner
last_updated: 2026-08-09
machine_contract: knowledge_promotion/knowledge_learning_contract.yaml
---

# 投研知识沉淀闭环

## 1. 为什么需要闭环

本项目不能只回答一次问题。真正的长期价值来自：每次研究都留下可追溯经验；经验经过验证后改变正式资产；正式资产在后续任务中被使用；系统再观察这些资产是否真正改善了研究。

闭环的完成条件是：

```text
Run N → Episode → Candidate → Evaluation → Approval → Release
      → Run N+1 使用 → Outcome Observation → 保留、更新或废弃
```

只生成报告、保存聊天记录、建立向量索引或生成候选，都不构成完整闭环。只有已经发布的资产才能进入正式 Context；生产使用记录只能表明相关性，冻结 Replay 的对照结果才用于证明有效性。

## 2. 报告、运行记录与知识

- **报告**回答本次研究得出了什么。
- **Execution Episode**记录本次发生了什么，包括失败、重试、证据、工具、Artifact 和审计。
- **Asset Candidate**回答本次相对既有资产建议改变什么。
- **Asset Revision**是候选或正式资产的一个不可变版本。
- **Asset Release**是某一作用域当前可供 Runtime 使用的版本集合。
- **Usage Observation**记录资产在后续任务中是否被选择、使用、帮助或造成回归。

单次 Judgment、未经核验的事实和模型原始思维过程不得直接成为正式知识。

## 3. 闭环什么

系统沉淀五类资产：

1. **证据与时态知识**：Source、EvidenceFact、事件、指标观测、有效期和替代关系。
2. **语义知识**：本体、关系、词典、参数、来源画像和数据映射。
3. **程序性知识**：方法、规则、Prompt、模板、Workflow 和 Skill。
4. **评测知识**：失败模式、成功案例、反例、Replay Case、指标和验收门槛。
5. **体验记忆**：用户偏好、主题历史和已验证的个性化约束。

机器值域以 `knowledge_learning_contract.yaml` 为唯一权威，本文不维护另一套枚举。

## 4. 三层知识隔离和读取优先级

- `global` 保存公共、可复用且完成正式治理的资产。
- `tenant` 保存租户私有事实、本体扩展、方法和案例。
- `user` 只保存个人偏好、主题索引和注释。

Context 以 global base 为基础，叠加 tenant overlay，最后使用 user preference。下层不得放宽上层证据门、权限和安全规则。tenant/user 内容默认禁止晋升 global；晋升必须脱敏、重新取证并走多角色审批。

## 5. 双 Diff、rebase 和并发 Run

每个 Task 创建时生成 `KnowledgeLock`，固定本次真正使用的 global、tenant 和 user 版本。

`KnowledgeLock` 同时固定 `asOf`。Runtime 对时态事实使用左闭右开区间 `validFrom <= asOf < validTo`：尚未生效或已失效的事实仍保留在 Release 和历史血缘中，但不进入该 Task 的 Context。显式历史回放可在创建 Lock 时传入历史 `asOf`，之后不得修改。

ContextPackage 不建立另一张可编辑业务表，而是以 `context.assembled` append-only Event Manifest 持久留痕。Manifest 必须记录 KnowledgeLock、`asOf`、三层 Release ID、每个 AssetRef 的版本/指纹及选择原因，以便完整回放本次研究真正看到了什么。

Mining 第一次与该锁定基线比较，回答“相对本次运行当时的知识学到了什么”；审批或发布前再与当前最新 Release 比较，回答“现在是否仍可安全合并”。正式基线已经变化时必须 rebase；目标资产同时变化时登记冲突，冲突未解决不能发布。

语义相似度只用于提示可能重复。只有稳定 ID 或内容指纹一致时才可自动判定 `no_op`。

## 6. 风险、审批与晋升

系统采用四级风险：L0 自动记录运行与使用事实；L1 自动更新可逆且限制在原作用域的偏好和索引；L2 需要专项评测和资产 Owner；L3 需要影响分析、完整回归与多角色审批。

默认晋升标准、审批角色和状态迁移均以机器合同为准。关键原则是：

- 一次出现可以生成候选，但通常不能证明稳定复用价值。
- EvidenceFact 可以自动进入来源限定的证据账本，但不能自动成为无来源限定的公共真理。
- Method 必须通过跨任务 Replay 后才能发布。
- Skill 是成熟方法的运行形态，必须额外具备稳定 I/O、权限、失败状态、成本和延迟合同。
- 废弃只关闭默认使用和有效期，不物理删除历史。

## 7. 时态事实与来源

事实必须保留 subject、predicate、value、recordedAt、sourceRefs、适用范围和置信度。可变事实应有 validFrom/validTo；新事实与旧事实冲突时关闭旧事实有效期并建立 supersedes，而不是覆盖或删除。

未经过 Source Capture、缺少 locator/短引文/内容哈希或来源核验失败的内容，不能升级为 EvidenceFact。历史任务按自己的 KnowledgeLock 回放，当前任务默认只读取当前有效版本，同时允许 `asOf` 历史查询。

## 8. Method 到 Skill

推荐成熟路径：

```text
Observed Pattern → Method Candidate → Validated Method
→ Capability Candidate → Released Skill
```

重复次数只是触发评审的条件，不是质量证明。方法和 Skill 的晋升必须使用冻结输入、冻结来源和同一评测集进行 A/B 对照；不得用实时搜索差异伪装成能力提升。

## 9. Eval Case、冻结 Replay 与质量证明

失败、严重返工、用户实质修改和稳定成功案例都可以生成 Eval Case 候选。正式 Case 必须脱敏、可重放、带明确断言，并说明来源 Run。

发布评测至少包含目标资产专项检查、受影响历史 Replay、严重回归门和成本/延迟记录。生产环境中的使用率、点赞或选择次数只能形成 Usage Observation，不能单独证明资产有效。

## 10. 发布、回滚、废弃与历史查询

候选在隔离 Revision 上完成验证。发布时生成不可变 Release Manifest，原子切换 current 指针，然后重建 FTS、向量和图索引。索引是可丢弃、可重建的派生物，不得成为资产权威。

发布失败时旧 Release 和旧索引继续服务。回滚不修改历史 Manifest，而是以已验证的旧 Release 为基线创建一个新 Release，原子切换 current 指针并记录 `rollbackOfReleaseId`；不得删除失败版本和审批历史。

## 11. 闭环指标

必须持续观察：Candidate provenance 完整率、候选接受率、误报率、资产有效复用率、过期事实泄漏、跨租户泄漏、发布回归、人工积压、研究返工、引用正确率、正确弃权率、成本和延迟。

`selected` 和 `used` 由 Runtime 记录；`helpful` 和 `regression` 由内部评测或治理流程写回。写回资产必须属于该 Task 的 KnowledgeLock，防止把未使用资产误记为有效或回归。重复观测必须幂等。

知识条目数量不是成功指标。没有被使用或不能证明改善研究的资产，应进入监控、修正或废弃流程。

## 12. 操作手册

1. 先检查 Candidate 的作用域、来源 Run、Artifact/Event 和 KnowledgeLock。
2. 查看运行基线、当前基线和候选 Revision 三方 Diff。
3. 检查重复候选、当前目标和未解决冲突。
4. 执行对应资产类型的 Verifier 和冻结 Replay。
5. 只由合同要求的角色追加审批决定。
6. 发布后检查索引指纹、Context 读取版本和首批 Usage Observation。
7. 发生回归时停止新 Release 使用，保留历史并创建修正候选。

## 13. 常见反模式

- 把每次报告全文直接塞进向量库并称为知识沉淀。
- 让模型在研究主链中直接修改正式本体或 Skill。
- 用出现次数替代质量评测。
- 覆盖旧事实而丢失历史有效期。
- 让 tenant/user 内容静默进入 global。
- 让 Candidate 在审批前参与正式 Context。
- 用生产使用次数声称因果提升。

## 14. GitHub 参考

- [Graphiti](https://github.com/getzep/graphiti)：借鉴 Episode、时态事实、失效保留和 provenance；不强制采用其图数据库。
- [LangMem](https://github.com/langchain-ai/langmem)：借鉴后台学习与主路径解耦；不允许 Agent 无治理修改正式资产。
- [OpenSPG/KAG](https://github.com/OpenSPG/KAG)：借鉴 Schema 约束抽取和知识—原文双向索引；不把开放抽取结果直接当正式本体。
- [OpenLineage](https://github.com/OpenLineage/OpenLineage)：借鉴 Run/Artifact 分离和追加式事件。
- [MLflow](https://github.com/mlflow/mlflow) 与 [DSPy](https://github.com/stanfordnlp/dspy)：借鉴 Trace、Dataset、评测、版本与 Registry 发布。
- [GPT Researcher](https://github.com/assafelovic/gpt-researcher)：借鉴研究执行和来源跟踪；其报告流水线不能替代资产治理闭环。

## 15. 文档版本与决策变更记录

- `1.1.0`（2026-08-09）：增加 KnowledgeLock `asOf`、时态区间过滤、Context Event Manifest 和受锁定资产约束的 helpful/regression 幂等回流。
- `1.0.0`（2026-08-09）：建立五类资产、三级隔离、双 Diff、风险分级、评测审批、Release 和 Usage 回流的完整合同。
