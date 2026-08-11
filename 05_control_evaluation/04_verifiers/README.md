# Verifiers

这里回答「确定性条件是否满足」。它检查 schema、字段、来源、回溯、阈值、发布闸门与可重放性；通过 Verifier 只表示产物合规，不表示研究结论一定有洞察或帮助决策。

| 需要确认 | 入口 |
|---|---|
| 全库一致性 | `python3 05_control_evaluation/04_verifiers/validate_project.py` |
| 单次运行可发布性 | `python3 05_control_evaluation/04_verifiers/validate_run.py <运行目录>` |
| 本体一致性 | `python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py` |
| 规则归属 | `python3 05_control_evaluation/04_verifiers/validate_rule_authority.py` |

`stages/` 是唯一的阶段校验实现，`fixtures/` 和 `tests/` 是回归证据。确定性发布规则见 [`deterministic_release_standard.md`](deterministic_release_standard.md)；研究质量 rubric 见 [`../05_evals/rubrics/research_quality.md`](../05_evals/rubrics/research_quality.md)。

新增检查放本目录并挂入 `validate_project.py`；不要把主观洞察评分塞进 Verifier。
