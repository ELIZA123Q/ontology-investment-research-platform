# 半导体领域参数源

人工维护的领域预置知识。Runtime 只读 [`../business_instances.yaml`](../business_instances.yaml) 汇总 Bundle。

| 文件 | 内容 |
| --- | --- |
| `state_variables.yaml` | 半导体 `StateVariable` 正式类型实例 |
| `evidence_parameters.yaml` | EvidenceProfile / ProxyIndicator / SourceProfile / EvidenceRecipe |
| `reasoning_parameters.yaml` | PropagationTemplate / JudgmentLevelCriterionTemplate |
| `scenario_parameters.yaml` | ScenarioTemplate / BusinessScenarioTag |

改完后运行：

```bash
python3 01_semantic_knowledge/01_ontology/domains/semiconductor/build_business_instances.py
```

影子类型（非 StateVariable）不得写入 `models/`，也不得伪装为正式 Ontology Object。
