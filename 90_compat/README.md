# 90_compat — 旧顶层回放区

本目录收纳编号布局重组前的顶层兼容根，**可读、可回放，默认不新增写入**。

| 子目录 | 原顶层 | 目标权威 |
|--------|--------|----------|
| `ontology/` | `ontology/` | `01_semantic/01_ontology`（YAML 机器真源过渡期仍在此） |
| `methods/` | `methods/` | `02_tasks` + `03_capabilities` |
| `instances/` | `instances/` | `04_execution/03_workspace` |
| `evaluation/` | `evaluation/` | `05_governance/14_evals` |
| `knowledge/` | `knowledge/` | `90_compat/methods` / 五域 |
| `delivery/` | `delivery/` | `90_compat/methods/05_表达` |
| `workflow/` | `workflow/` | `02_tasks/04_workflows/deep_research` |
| `governance_mirrors/` | `governance/{architecture,contracts,validation,evaluation}` | `05_governance/01_架构` 等 |

策略权威：[`05_governance/01_架构/compat_policy.yaml`](../05_governance/01_架构/compat_policy.yaml)。
各子目录若有 `README.compat.md`，以其中 `mode` / `write_policy` 为准。
