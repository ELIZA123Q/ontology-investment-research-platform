# 语义知识域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

这里回答「系统如何理解世界」：用哪些概念、统一叫什么、对象之间是什么关系、证据对象及其溯源关系在语义上如何定义，以及这些语义如何组织成可查询、可追溯的图视图。

**不负责**「怎么做一次研究」（那是任务域与 Runtime）。

## 给谁看

- **研究员**：查名词、证据对象定义、理解「系统认什么事实」
- **维护者**：改本体/词典/图合同后的登记与校验

## 材料从哪来

| 子目录 | 白话含义 | 权威位置 |
|---|---|---|
| [`01_ontology/`](01_ontology/README.md) | 通用正式模型（含证据与 provenance 对象/关系类型）、领域正式扩展、状态变化规则 | 本目录下 ontology 正文与 `platform_registry.yaml` |
| [`02_dictionary/`](02_dictionary/README.md) | 人话 → 标准语义的归一化（别名/歧义/研究用语） | 词典 YAML；语义权威仍在 ontology |
| [`03_knowledge_graph/`](03_knowledge_graph/README.md) | 图怎么组织成可查询可追溯的视图 | 图合同 YAML |

总登记见 [`registry.yaml`](./registry.yaml)。跨域「权威在哪」见 [`five_domain_authority.yaml`](../05_control_evaluation/01_架构/five_domain_authority.yaml)。

补充边界：

- 通用类型定义位于 `01_ontology/models/`
- 行业专属正式扩展位于 `01_ontology/domains/<domain>/ontology_extension.yaml`
- 领域研究参数不得写入 `models/`；人工源在 `parameters/`，Runtime 读生成 Bundle
- 场景类型目录位于 [`02_scenario_task/scenario_catalog.yaml`](../02_scenario_task/scenario_catalog.yaml)，不属于 Ontology Object Model
- 本体唯一机器入口：[`01_ontology/platform_registry.yaml`](01_ontology/platform_registry.yaml)
- 本体校验：[`05_control_evaluation/03_校验/ontology/validate_ontology.py`](../05_control_evaluation/03_校验/ontology/validate_ontology.py)

## 怎么用

1. 先明确你是要查**概念定义**（ontology/dictionary，含 EvidenceFact / provenance）还是**关系结构**（knowledge_graph）。
2. 打开对应子目录 README，按「最短路径」进正文；证据对象权威见 [`01_ontology/models/evidence.yaml`](01_ontology/models/evidence.yaml)。
3. 如需查找语义域之外的取证方法与数据访问能力：来源速查与 OPS 见 [`03_agent_capability/05_method_libraries/03_取证/`](../03_agent_capability/05_method_libraries/03_取证/README.md)；MCP 通道见 [`03_agent_capability/04_protocols/mcp/`](../03_agent_capability/04_protocols/mcp/README.md)。

## 怎么维护

- 新增或修改正式语义对象：写入本域对应子目录，并更新本域/`子域` registry。
- 改完跑项目与本体相关校验（见 [`05_control_evaluation/03_校验/`](../05_control_evaluation/03_校验/README.md) 与 ontology 子目录说明）。
- 不要在 Runtime 里另写一套「平行本体」；Runtime 只消费登记过的语义。

---

## 维护者附录（可跳过）

| 项 | 值 |
|----|----|
| status | `active` |
| write_entry | `01_semantic_knowledge/` |
| 上位 | [`00_五域系统骨架.md`](../05_control_evaluation/01_架构/00_五域系统骨架.md) |
| 权威查找顺序 | five_domain_authority → 本域 registry → 子域 registry |
