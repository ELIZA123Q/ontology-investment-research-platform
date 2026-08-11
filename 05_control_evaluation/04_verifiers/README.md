# Verifiers

这里回答「确定性条件是否满足」。它检查 schema、字段、来源、回溯、阈值、发布闸门与可重放性；通过 Verifier 只表示产物合规，不表示研究结论一定有洞察或帮助决策。

| 需要确认 | 入口 |
|---|---|
| 全库一致性 | `python3 05_control_evaluation/04_verifiers/validate_project.py` |
| 本体一致性 | `python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py` |
| 规则归属 | `python3 05_control_evaluation/04_verifiers/validate_rule_authority.py` |
| 方法资产 | `python3 05_control_evaluation/04_verifiers/validate_method_assets.py` |
| 知识沉淀合同 | `python3 05_control_evaluation/04_verifiers/validate_knowledge_learning_contract.py` |
| 禁止本体双写 | `python3 05_control_evaluation/04_verifiers/validate_no_semantic_ontology_double_write.py` |
| 连接器与本体映射 | `python3 05_control_evaluation/04_verifiers/validate_connector_mapping_contract.py` |

vNext 的单次运行校验由 Runtime Verifier、Node Catalog、Action Service 与 TypeScript 测试共同执行；本目录不保留旧固定五阶段包校验。确定性发布规则见 [`deterministic_release_standard.md`](deterministic_release_standard.md)；研究质量 rubric 见 [`../05_evals/rubrics/research_quality.md`](../05_evals/rubrics/research_quality.md)。

跨仓库治理检查挂入 `validate_project.py`；Runtime 行为检查优先放在 `06_runtime/tests/`。不要把主观洞察评分塞进 Verifier。
