---
name: touyan-yanjiu-sheji-pingshen
description: 在取证前评审研究设计，检查问题定义、决策用途、对象范围、信息截面、关键矛盾、竞争假设、证据方案、反证和停止条件是否足以启动研究。
---

# 研究设计评审

## 职责

在任何完整研究进入取证前，审查 `ResearchDesign` 是否能区分主假设与竞争假设。只评审设计，不补写事实、不执行取证、不形成判断。

需要交付机器可检查的结果时，先阅读 [references/design-review-contract.md](references/design-review-contract.md)，并用 `scripts/validate_design_review.py` 校验输出。

## 必查项

- 问题是否是可回答的研究问题，而不是宽泛主题；
- 决策用途是否明确，且输出边界没有越权；
- 对象、地区、时间、单位、指标和业务窗口是否冻结；
- 主假设与至少一条竞争假设是否可区分；
- 每条假设是否有可观察预测和决定性反证；
- 证据方案是否覆盖 primary、baseline、mechanism、cross_check、counter 中实际需要的角色；
- 是否存在反向因果、共同原因、口径偷换、时间错配或样本偏差；
- 停止条件是否能阻止证据不足时硬写结论。

## 裁决

输出顶层对象 `design_review`：

- `pass`：可进入取证；
- `needs_revision`：设计可修正，但当前不宜取证；
- `block`：问题、边界或授权缺失，无法可靠研究。

`pass` 不代表结论成立，只表示研究问题和取证方案可以启动。`needs_revision` 与 `block` 必须列出最小修改项。
