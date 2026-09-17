---
name: touyan-zhanlue-yanjiu-zongkong
description: 为非A股权益或资产类别未明确的广义战略研究执行总控分流，先识别产业、公司、政策、投资、技术路线或竞争战略任务；明确A股权益完整研究优先使用权益总控。
---

# 战略研究总控

## 职责

把用户的战略研究请求先转成可执行研究设计，而不是直接写结论。适用于产业战略、公司战略、政策战略、技术路线、竞争格局，以及资产类别或市场范围尚未固定的投资研究入口分流。

若请求已经明确是 `asset_class: equity`、`market_scope: A_share` 且 `mode: full_research | research_update`，不要由本 Skill 承接完整编排，改用 [`touyan-quanyi-yanjiu-zongkong`](../touyan-quanyi-yanjiu-zongkong/SKILL.md)。若只是证据刷新，交给 [`touyan-gongkai-zhengju-diaoyan`](../touyan-gongkai-zhengju-diaoyan/SKILL.md)。

本 Skill 只决定研究类型、边界、最小方法链和停止条件，不自行形成事实、正式判断、交易建议或发布结果。

## 任务分类

先固定：

- `research_question`：要回答的战略问题；
- `decision_use`：服务于立项、配置、竞争判断、政策研判、技术路线、投资命题还是复盘；
- `object_scope`：行业、公司、技术、政策、区域、产品或资产范围；
- `information_cutoff` 与 `business_time`；
- `strategy_type`：industry | company | policy | investment | technology | competition | mixed；
- `output_boundary`：报告、证据交接、研究设计、复盘或载体比较。

无法固定这些字段时，先调用研究设计评审并记录缺口；不得用标题关键词补造范围。

## 编排规则

1. A股完整权益研究使用权益总控；非A股、非权益、非投资研究，或资产类别尚未明确的研究，才使用通用 `strategic_research` 路由。
2. 涉及机制、归因、传导或影响兑现时，调用 [`touyan-yinguo-shibie`](../touyan-yinguo-shibie/SKILL.md) 形成取证前 `CausalDesign`。
3. 所有核心事实、关键数字、政策条款、竞争格局和反证都交给公开证据调研；搜索和二手摘要只能发现入口。
4. 取证前必须经过研究设计评审；取证后才进入推理、A10 或通用判断。
5. 最终成品必须经过独立成品验证；若验证为 `needs_revision` 或 `block`，不得进入发布审批。

## 输出

交付一份 `strategic_research_route`，至少包含：

- 研究类型与选择理由；
- 使用或跳过的 Skill；
- 研究设计必填字段；
- 必要证据角色与反证任务；
- 因果识别是否启用；
- 最终输出边界；
- 停止条件和改判触发点。

输出不得包含买卖、仓位、目标价、收益承诺、下单执行或未授权择时。
