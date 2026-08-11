# 校验器 — 确定性条件是否满足

> 上级目录：[`05_control_evaluation/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里检查格式、字段、来源、回溯、阈值、发布闸门和可重放性。好比质检流水线——检查产品规格是否达标，但不评价产品好不好用。

> 通过 Verifier 只表示产物**合规**，不表示研究结论一定有洞察或帮助决策。

## 里面有什么

7 个校验器入口：

| 要检查什么 | 命令 |
|-----------|------|
| 全库一致性 | `python3 05_control_evaluation/04_verifiers/validate_project.py` |
| 本体一致性 | `python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py` |
| 规则归属 | `python3 05_control_evaluation/04_verifiers/validate_rule_authority.py` |
| 方法资产 | `python3 05_control_evaluation/04_verifiers/validate_method_assets.py` |
| 知识沉淀合同 | `python3 05_control_evaluation/04_verifiers/validate_knowledge_learning_contract.py` |
| 禁止本体双写 | `python3 05_control_evaluation/04_verifiers/validate_no_semantic_ontology_double_write.py` |
| 连接器与本体映射 | `python3 05_control_evaluation/04_verifiers/validate_connector_mapping_contract.py` |

## 日常怎么用

- **改了定义后** → 跑 `validate_project.py`（全库检查）
- **改了本体后** → 跑 `validate_ontology.py`
- **合并前** → 跑 `validate_project.py`

## 怎么维护

- vNext 的单次运行校验由 Runtime Verifier、Node Catalog、Action Service 与 TypeScript 测试共同执行
- 本目录**不保留**旧固定五阶段包校验
- 跨仓库治理检查挂入 `validate_project.py`
- Runtime 行为检查优先放在 `06_runtime/tests/`
- **不要**把主观洞察评分塞进 Verifier

> 确定性发布规则见 [`deterministic_release_standard.md`](deterministic_release_standard.md)；研究质量 rubric 见 [`../05_evals/rubrics/research_quality.md`](../05_evals/rubrics/research_quality.md)。
