# 3 · 本体

稳定语义定义：对象是什么、关系是什么意思、变量怎么量。这里**不保存**某一次研究的事实或结论。**取证策略与裁决方法的权威正文在 [`methods/`](../methods)**；此处只定义类型、关系与约束。

| 编号 | 目录 | 内容 |
|------|------|------|
| 01 | [`01_通用`](01_通用) | 跨行业通用的对象、关系、推理与证据规范 |
| 02 | [`02_领域`](02_领域) | 行业扩展；目前主要是 `semiconductor`（半导体） |
| 03 | [`03_迁移`](03_迁移) | 已发生的版本迁移账本；只用于兼容与追溯，不是当前定义入口 |

研究员日常很少需要直接改这里。做 02 阶段时，若规范提到某个类型或变量，可到对应 YAML / 说明文档核对含义。

## 当前权威版本

- 元模型：`01_通用/meta_schema.yaml`，版本 1.0.0。
- 通用本体：`01_通用/models/`，版本 3.0.0，分为语义对象、状态事件、证据、判断约束、研究场景五个模型。
- 半导体扩展：`01_通用/models/semiconductor_extension.yaml`，版本 3.0.0；其 namespace 仍为 `semiconductor`。领域资料目录由外部流程保持只读同步。
- 冻结门：`python3 ontology/01_通用/validate_v3.py`。

正式本体回答“有什么、如何关联、哪些稳定约束成立”。方法选择、方法执行、API、任务调度、权限、Saga 和性能均不属于正式本体。

`metadata.status=draft` 的类型已定义但未纳入当前 Runtime 实例图投影（含 `ResearchScenario` 实例化路径）。资本市场骨架（`Asset` / `Listing` 等）与判断后投影（`MarketExpectation` / `ExpectationGap` / `AssetImpact`）已为 `active`；后续扩大须先完成规则 SSOT（见路线图 P1）。任务里的 `research_scenario` 只引用 `scenario_types` 枚举。

正式规则的执行面见 [`governance/02_合同/rule_authority_registry.yaml`](../governance/02_合同/rule_authority_registry.yaml)：`runtime_semantic_execution` + `blocking` 派生 Runtime `REQUIRED_RULES`；`semantic_endpoint_compatibility` 只在实例图物化时由 `validateRuntimeGraph` 执行；标为 `unimplemented` 的规则不得宣称为已挡门。

领域业务参数实例（证据画像、状态变量、传导模板等）仍在 `02_领域/semiconductor/business_instances.yaml`。

项目只维护 Ontology 3.0 / Public Contract 最新正式基线；新模板、新样例和新运行不得引用已退役的 2.x 文件路径或旧资源 ID。
