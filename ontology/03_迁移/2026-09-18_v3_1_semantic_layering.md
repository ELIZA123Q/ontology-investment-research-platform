# 2026-09-18 v3.1 兼容式语义分层迁移账本

## 迁移性质

本次迁移是 Ontology 3.0 的兼容式增强，不是破坏性 v4。顶层 `schema_version` 继续保持 `3.0.0`，运行时与历史样例仍可读取既有对象和关系。

## 新增能力

- 证据观察层新增 `Episode`，用于表达系统一次接收、截取、导入或人工登记的信息片段。
- `EvidenceClaim` 保留 `claimCitesSource`，新增推荐关系 `claimSupportedByEpisode`。
- 估值与资产投影新增可选中间对象：`BusinessImpact`、`FinancialImpact`、`EstimateRevision`。
- `ReasoningTrace` 允许纳入上述影响链条节点。

## 兼容规则

- 历史实例不要求批量补写 `Episode`。
- 新产物优先采用 `SourceDocument → Episode → EvidenceClaim → EvidenceFact`，但必须保留 `EvidenceClaim → SourceDocument` 的直接追溯。
- 不新增独立 `State` 对象；建议中的 State 在本仓库对应 `Observation / StateSnapshot`。
- 不拆分 `Signal`；SupportingSignal 和 BlockingSignal 是 `Signal.role` 的视图别名。
- 不新增 `ValuationConclusion`；公开结论仍由 `Judgment` 和 `AssetImpact` 承接。

## 后续要求

- 新样例应至少展示一条 Episode 链路。
- 涉及估值或资产影响的高强度判断，应优先补齐业务、财务、预测修正和资产影响链条。
