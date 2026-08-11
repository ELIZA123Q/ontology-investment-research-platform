# 语义知识域 — 系统认识世界的概念表

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

这里定义「系统认识什么」。好比研究员的术语手册——概念怎么定义、术语怎么统一、对象之间什么关系，都在这里。系统做研究时引用的概念，都必须在这里登记过。

**不管**「怎么做一次研究」（那是 `02_scenario_task/` 和 `06_runtime/` 的事）。

## 里面有什么

| 子目录 | 一句话说明 | 你需要管吗 |
|--------|-----------|-----------|
| [`01_ontology/`](01_ontology/README.md) | **本体**：系统认识哪些对象、对象之间什么关系、状态怎么变化 | 加新概念或关系时改 |
| [`02_dictionary/`](02_dictionary/README.md) | **词典**：自然语言到标准术语的翻译表（比如「营收」=「营业收入」） | 加新术语或同义词时改 |
| [`03_knowledge_graph/`](03_knowledge_graph/README.md) | **知识图规则**：图怎么组织、什么关系允许画线、怎么追溯 | 改图结构规则时改 |

> 总登记见 [`registry.yaml`](registry.yaml)。

## 日常怎么用

- **查概念定义**：去 `01_ontology/` 找对应的 YAML 文件
- **查术语映射**：去 `02_dictionary/` 找同义词和歧义规则
- **查图结构规则**：去 `03_knowledge_graph/` 找图合同

## 怎么维护

1. 新增或修改概念/术语/图规则，写在对应子目录的 YAML 文件里
2. 更新对应子目录的 `registry.yaml`
3. 改完跑校验：
   ```bash
   cd 06_runtime
   npm run domain:sync     # 同步到程序
   ```
4. 如果改了本体，还要跑：
   ```bash
   python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py
   ```
5. **不要在 `06_runtime/` 里另写一套概念定义** — 06 只消费这里的定义

## 常见问题

**Q：本体和词典有什么区别？**
A：本体是「系统认识哪些对象」（比如「公司」是一个对象，「供应链关系」是一种关系）。词典是「同一个东西有哪些叫法」（比如「营收」「收入」「营业收入」是同一个概念的不同说法）。

**Q：什么是「平台注册表」？**
A：`01_ontology/platform_registry.yaml` 是系统的唯一机器入口——程序通过这个文件找到所有本体定义。改了本体文件，要确保注册表里登记了。

**Q：行业专属参数放哪？**
A：通用概念放 `01_ontology/models/`；半导体专属扩展放 `01_ontology/domains/semiconductor/`。不要混放。

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| status | `active` |
| write_entry | `01_semantic_knowledge/` |
| 上位 | [`README.md`](../README.md) |
| 权威查找顺序 | 根目录职责地图 → 本域 registry → 子域 registry |

### 边界补充

- 通用类型定义位于 `01_ontology/models/`
- 行业专属正式扩展位于 `01_ontology/domains/<domain>/ontology_extension.yaml`
- 领域研究参数不得写入 `models/`；人工源在 `parameters/`，Runtime 读生成 Bundle
- 场景类型目录位于 [`02_scenario_task/02_scenarios/types.yaml`](../02_scenario_task/02_scenarios/types.yaml)，不属于 Ontology Object Model
- 本体唯一机器入口：[`01_ontology/platform_registry.yaml`](01_ontology/platform_registry.yaml)
- 本体校验：[`05_control_evaluation/04_verifiers/ontology/validate_ontology.py`](../05_control_evaluation/04_verifiers/ontology/validate_ontology.py)

### 跨域引用

- 取证方法与数据访问能力：[`03_agent_capability/02_skills/evidence_research/references/`](../03_agent_capability/02_skills/evidence_research/references/README.md)
- MCP 通道：[`03_agent_capability/04_protocols/mcp/`](../03_agent_capability/04_protocols/mcp/README.md)
- 跨域职责边界：[`06_runtime/ARCHITECTURE.md`](../06_runtime/ARCHITECTURE.md)
