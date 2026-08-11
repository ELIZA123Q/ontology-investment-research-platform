# 确定性发布与返工标准

本文件只规定可无歧义判定的发布条件。它不评价「是否有洞察」「是否遗漏关键问题」或「是否帮助决策」；这些属于 [`../05_evals/rubrics/research_quality.md`](../05_evals/rubrics/research_quality.md)。

## 权威状态

| 维度 | 权威字段 |
|---|---|
| 阶段完成 | `stage_status` |
| 阶段输出状态 | `quality_status` |
| 证据质量 | `evidence_grade` |
| 判断强度 | `judgment_level` |
| 03 路径可推性 | `path_readiness_status` |
| 04 路径结果 | `path_result_status` |

`stage_status` 仅可为 `not_started`、`in_progress`、`complete`、`blocked`、`returned`。`evidence_permission`、`allowed_04_output`、`maximum_judgment_level` 与 `publishable` 必须由规则派生，不能人工填写。

## 发布闸门

正式发布必须满足：同一 Task/Run 的所需产物完整；各阶段确定性检查通过；证据与判断未越权；05 没有引入未被 03/04 支撑的事实、判断或更强表达；不存在未说明的范围漂移或引用断裂。入口为 `validate_run.py`。

问题必须返回最早出错阶段：问题与范围回 01，逻辑与竞争解释回 02，数据/来源/口径回 03，推理与强度回 04，表达与可读性回 05。
