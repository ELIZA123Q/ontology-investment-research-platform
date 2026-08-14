# 评估 — 结果到底好不好、有没有价值

> 上级目录：[`05_control_evaluation/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里评价研究质量、遗漏、决策帮助和相对基线。好比研究报告的同行评审——不是检查格式对不对（那是 Verifier 的事），而是评价研究有没有洞察力、对决策有没有帮助。

## 里面有什么

| 子目录 | 一句话说明 |
|--------|-----------|
| `protocols/` | **评测规则**：评测怎么做的正式规则、聚合口径与验收手册 |
| `rubrics/` | **质量标准**：人类可读的研究质量标准（研究员日常用这个） |
| `cases/` | **案例**：真实冻结案例候选与正式案例 |

> 机器可判定的检查（格式、来源存在性等）见 [`../04_verifiers/`](../04_verifiers/README.md)。

## 日常怎么用

1. **日常判断研究质量** → 先看 [`rubrics/research_quality.md`](rubrics/research_quality.md)
2. **交付前** → 跑 Verifier 检查格式合规
3. **正式评测** → 按 `protocols/` 下的规则执行

> Verifier 和 Eval **不能互相替代**：Verifier 不给洞察打分，Eval 也不冒充 Schema 校验。

## 常见问题

**Q：当前有多少正式评测案例？**
A：当前已有 1 个由真实 MCP 调用形成、证据门通过的 `restraint` 候选，但正式案例仍为 0。在系统产物冻结、同证据基线、双路独立裁决、模型校准和下游实验完成前，不得宣称流程增益。

另有 1 次公开冻结案例的三轨同证据诊断，见 [`pilots/2026-08-13-public-same-evidence-pilot.yaml`](pilots/2026-08-13-public-same-evidence-pilot.yaml)：系统、直答和摘要路径都正确停止，但它没有盲评或校准，仍不构成正式分数或相对优势证明。

另有 1 个真实公开业绩更新确定性回放，见 [`cases/dongwei-688261-2025-preliminary-results/`](cases/dongwei-688261-2025-preliminary-results/)。它已验证原文哈希和数值重算，但仅检验财务事实与边界，不计入正式价值评测。

**Q：候选案例能进入正式分数统计吗？**
A：不能。候选不得进入正式分数统计。
