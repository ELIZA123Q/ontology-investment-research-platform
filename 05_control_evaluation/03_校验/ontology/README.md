# Ontology 校验

Ontology YAML 定义在 `01_semantic_knowledge/01_ontology/`；本目录负责检查它们有没有被破坏。

| 文件 | 作用 |
|---|---|
| [`validate_ontology.py`](./validate_ontology.py) | 统一本体校验（语义深度 + platform/kinetics） |
| [`rule_interpreter.py`](./rule_interpreter.py) | 执行 YAML `condition` / `counter_conditions` fixture |

入口：

```bash
python3 05_control_evaluation/03_校验/ontology/validate_ontology.py
```

权威登记仍是：

```text
01_semantic_knowledge/01_ontology/platform_registry.yaml
```
