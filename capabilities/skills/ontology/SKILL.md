---
name: ontology
description: >
  本体语义技能集。本体目录加载、模型模式辅助、
  关系选项、语义基线、规则计算与执行、实例图构建、
  Stage03前置检查、结构审查、变量可比性。
metadata:
  category: ontology
  stage: "02-04"
  short-description: 本体加载、规则计算、实例图与语义执行
---

# 本体语义技能集

## 触发条件

- Stage02 需要加载本体对象类型/关系/规则来建立判断结构
- Stage03 需要核验证据草稿的本体合规性
- Stage04 需要执行规则计算与语义裁决
- 关键词：本体、对象类型、关系、规则、实例图、语义

## 核心原则

**本体提供统一语义和约束，不自动推出结论。** 推理发生在 Stage04 与 Runtime，不是本体自动完成的。

## 组成文件

| 文件 | 职责 |
|------|------|
| `catalog_loader.ts` | 本体目录加载：从 `model_registry.yaml` 加载全部正式本体模型文件，构建类型索引 |
| `catalog_loader_adapter.ts` | 目录加载适配：为不同调用方提供统一接口 |
| `model_schema_helpers.ts` | 模型模式辅助：属性定义、类型检查工具 |
| `vocabulary.ts` | 受控词汇：判断类型、证据角色、优先级等枚举 |
| `display_labels.ts` | 显示标签：本体元素的中文/英文标签 |
| `relation_options.ts` | 关系选项：可用关系类型及其约束 |
| `contribution_summary.ts` | 贡献摘要：本体元素对判断单元的贡献 |
| `governance.ts` | 本体治理：演进规则、废弃管理 |
| `impact.ts` | 本体变更影响分析 |
| `semantic_baseline.ts` | 语义基线：冻结语义版本的哈希与差异 |
| `semantic_context.ts` | 语义上下文：为 LLM 构建本体约束上下文 |
| `semantic_execution.ts` | 语义执行：在本体约束下执行判断逻辑 |
| `semantic_reads.ts` | 语义读取：从本体读取指定元素 |
| `rule_compute.ts` | 规则计算：执行正式规则（冻结门、阈值判定） |
| `rule_defs.ts` | 规则定义：规则的结构化表示 |
| `rule_predicates.ts` | 规则谓词：可复用谓词函数 |
| `research_queries.ts` | 研究查询：从本体生成研究问题 |
| `research_query.ts` | 单条研究查询类型 |
| `research_value.ts` | 研究价值：基于本体的价值评估 |
| `revise_schemas.ts` | 修改模式：受控修改的 schema 定义 |
| `stage03_precheck.ts` | Stage03 前置检查：证据草稿的本体约束预检 |
| `structure_review.ts` | 结构审查：判断结构的本体合规审查 |
| `variable_comparability.ts` | 变量可比性：判断两个本体变量是否可比 |
| `variable_comparability_engine.ts` | 变量可比性引擎：可比性计算逻辑 |
| `tools.ts` | 工具函数：本体操作的工具集 |
| `instance_graph/` | 实例图子系统：构建、物化、投影、追溯（含 authority, load, materialize, projection, trace） |
| `ontology_instance_graph.py` | Python 实例图实现 |
| `runtime_instance_graph.py` | Python 运行时实例图 |

## 使用流程

1. Stage02：加载本体目录 → 核验对象类型是否在领域覆盖内 → 选定可用关系与规则
2. Stage03：执行 Stage03 前置检查 → 核验证据草稿是否违反本体约束
3. Stage04：加载规则定义 → 执行规则计算 → 在语义上下文下裁决

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `ontology/01_通用/model_registry.yaml` | 正式本体模型注册表（机器权威） |
| `ontology/01_通用/models/` | 正式模型 YAML 文件 |
| `ontology/01_通用/*.md` | 通用本体人类说明 |
| `ontology/02_领域/semiconductor/` | 半导体领域扩展 |
| `governance/05_元治理本体/` | 元治理本体（本体演进规则） |
| `governance/02_合同/ontology_consumer_registry.yaml` | 本体消费者注册 |

## 输出规范

- 本体目录加载后缓存，fingerprint 变更时自动刷新
- 规则计算结果含：规则ID、输入变量、判定结果、依据
- 实例图含：实例节点、关系边、来源追溯
