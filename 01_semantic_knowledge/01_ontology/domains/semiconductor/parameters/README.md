# 半导体领域参数源 — 预置的研究参数

> 上级目录：[`semiconductor/`](../README.md) | 根目录：[`README.md`](../../../../../../README.md)

这里存放人工维护的半导体领域预置知识——状态变量、证据画像、传导模板等。Runtime 只读生成好的汇总文件（`business_instances.yaml`），不直接读这里的源文件。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `state_variables.yaml` | 半导体的状态变量定义（如库存水平、产能利用率） |
| `evidence_parameters.yaml` | 证据画像、代理指标、来源画像、证据配方 |
| `reasoning_parameters.yaml` | 传导模板、判断等级标准模板 |
| `scenario_parameters.yaml` | 场景模板、业务场景标签 |

## 怎么维护

改完参数后必须重新生成 Bundle：

```bash
python3 01_semantic_knowledge/01_ontology/domains/semiconductor/build_business_instances.py
```

> 影子类型（非 StateVariable）不得写入 `models/`，也不得伪装为正式 Ontology Object。
