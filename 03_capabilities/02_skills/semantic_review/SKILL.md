---
name: semantic-review
description: >
  独立语义审查技能集。五项04忠实性检查、十项05整体质量检查、
  关系审计、模式审查、产物读取适配。
metadata:
  category: semantic_review
  stage: "04-05"
  short-description: 独立语义审查（五/十项检查）与关系审计
---

# 独立语义审查技能集

## 触发条件

- Stage04 人类确认前：执行五项忠实性检查
- Stage05 交付前：执行十项整体质量检查
- 需要审查判断结构与本体视图的语义一致性
- 关键词：语义审查、忠实性、审计、关系审计

## 核心原则

**生产者不得自审。** 生产模式禁止测试 reviewer。审查结果分 pass / fail / needs_human 三级。

## 组成文件

| 文件 | 职责 |
|------|------|
| `semantic_review.ts` | 独立语义审查主逻辑：04五项检查 + 05十项检查 |
| `formal_semantic_review.ts` | 正式语义审查：结构化审查报告的生成与校验 |
| `relation_audit.ts` | 关系审计：检查本体关系在判断产物中的使用一致性 |
| `schemas_review.ts` | 模式审查：审查产物是否符合输出 schema 约束 |
| `artifact_read_adapter.ts` | 产物读取适配：统一读取各阶段产物的接口 |

## 04 五项忠实性检查

| # | 检查 | 说明 |
|---|------|------|
| 1 | `local_evidence_not_globalized` | 局部证据未被全局化（证据来源范围不超过实际采集范围） |
| 2 | `parent_aggregation_complete` | 父级聚合完整（子判断单元的结论正确聚合到父级） |
| 3 | `incremental_update_is_local_first` | 增量更新局部优先（修改先影响局部再传导） |
| 4 | `title_represents_major_scopes` | 标题代表主要范围 |
| 5 | `conditions_scope_and_prohibitions_preserved` | 条件范围与禁止项保留 |

## 05 新增五项整体质量检查

| # | 检查 | 说明 |
|---|------|------|
| 6 | `main_judgment_is_clear_and_prioritized` | 主判断清晰且优先 |
| 7 | `maximal_valid_judgment_is_expressed` | 最大有效判断被表达（不低报） |
| 8 | `uncertainty_is_concentrated_not_overloaded` | 不确定性集中而非分散 |
| 9 | `research_edge_is_substantive` | 研究增量有实质内容 |
| 10 | `key_unknowns_are_decision_relevant` | 关键未知对决策有影响 |

## 使用流程

1. 确定审查目标（04 还是 05）
2. 加载被审查产物（通过 `artifact_read_adapter`）
3. 执行对应检查集
4. 生成审查报告（pass / fail / needs_human）
5. 对 fail 项目标注 return_to_stage

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `05_governance/02_合同/public_contract.yaml` | 公共合同 |
| `05_governance/02_合同/governance_control_contract.yaml` | 治理控制合同 |
| `05_governance/03_校验/00A_高质量产出判别标准.md` | 质量自检标准 |
| `01_semantic/01_ontology/models/` | 正式本体模型 |

## 输出规范

- 每个检查含：check_id、result（pass/fail/needs_human）、reason
- fail 时含 return_to_stage（退回到哪个阶段）
- 审查报告含 reviewer_id 与审查时间
