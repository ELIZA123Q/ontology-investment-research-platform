# Ontology 关系改名影响面（2026-07-20）

| 旧名 | 新名 | 权威出处 |
|------|------|----------|
| `factSupportedByClaim` | `factDerivedFromClaim` | `01_semantic_knowledge/01_ontology/models/evidence.yaml` |
| `assessmentEvaluatesEvidence` | `assessmentEvaluatesFact` | `01_semantic_knowledge/01_ontology/models/evidence.yaml` |

## 已对齐表面

- `05_control_evaluation/04_verifiers/stages/stage_03/validate_03_outputs.py`
- `06_runtime/contracts/runtime_supported_profile.yaml`
- `06_runtime/engine/action_executor.ts`
- `06_runtime/engine/instance_graph.ts`
- `06_runtime/engine/runtime_operations.yaml`
- `06_runtime/engine/ontology_instance_graph.py`
- `06_runtime/engine/runtime_instance_graph.py`
- `06_runtime/workflow/stage_specs/02_结构/模板/02_任务本体视图模板.yaml`
- V3 / 回归夹具（已使用新名）

## 历史记录

- `docs/migrations/repository_history/ontology_evolution/2x_to_3_ledger.yaml` 保留 `factSupportedByClaim → factDerivedFromClaim` 映射键，作为 2.x→3.0 迁移证据，不得再改回运行时权威。

## 不在本次范围

- `06_runtime/.data/local_runs/exports/` 下本地调试导出（gitignore）可能仍含旧名；正式发布包与回归夹具以新名为准。
- 策略：`legacy_publish_compatibility: false`——旧字段不得进入正式产物。
