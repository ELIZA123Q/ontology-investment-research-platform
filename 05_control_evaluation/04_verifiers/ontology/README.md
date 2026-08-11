# 本体校验 — 检查本体定义有没有被破坏

> 上级目录：[`04_verifiers/`](../README.md) | 根目录：[`README.md`](../../../../README.md)

本体 YAML 定义在 `01_semantic_knowledge/01_ontology/`，本目录负责检查它们有没有被破坏——好比质检员检查产品规格是否达标。

## 里面有什么

| 文件 | 作用 |
|------|------|
| [`validate_ontology.py`](validate_ontology.py) | 统一本体校验（语义深度 + platform/kinetics 接线） |
| [`rule_interpreter.py`](rule_interpreter.py) | 执行 YAML 里的 `condition`/`counter_conditions` 测试 |

## 怎么用

```bash
python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py
```

> 权威登记仍是 `01_semantic_knowledge/01_ontology/platform_registry.yaml`。
