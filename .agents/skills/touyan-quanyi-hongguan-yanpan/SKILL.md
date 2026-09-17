---
name: touyan-quanyi-hongguan-yanpan
description: 为明确标记为A股权益的行业、主题、指数或公司研究执行宏观三问筛查，并在宏观、政策、信用或市场资金足以改变结论时展开深度研判。输出止于行业与风格影响，不用于纯宏观专题、非A股市场、个股买卖、仓位或择时。
---

# 权益宏观研判

## 目标

把宏观放在权益研究的上层入口，先分别回答经济走向、政策立场和资金松紧，再判断它们是否会改变目标行业或风格结论。不要复制研究框架正文；调用仓库已登记的方法并保留其证据门槛。

## 何时使用

- 对 `asset_class: equity`、`market_scope: A_share` 的任务至少执行 `screen`。
- 用户直接询问宏观、政策、流动性、信用或资金面时执行 `deep`。
- 筛查发现任一轴对核心结论具有高相关性、三轴明显背离，或目标对周期、政策、利率、信用、汇率、风险溢价或市场资金高度敏感时，由 `screen` 升级为 `deep`。
- 纯公司事件、会计核验或产品事实任务仍完成简版筛查；若三轴均不改变判断，记录低相关性并停止，不铺开宏观全景。

运行研究前读取 [三问研判协议](references/three-question-protocol.md)。

三问所需的经济、政策和资金证据统一交给[公开证据调研 Skill](../touyan-gongkai-zhengju-diaoyan/SKILL.md)执行，只传递三问中实际需要的 `EvidenceTask`。收到通过结构校验的 `evidence_handoff` 后再形成 `macro_context`；缺少关键角色时保留 `unknown`、降低置信度或停止，不能由宏观 Skill 补写证据。

如研究请求显式选择 `methodology.analyst_lens_refs`，还须读取[分析师视角使用协议](references/analyst-lens-protocol.md)与已选[视角卡](../../../研究方法/分析师视角/analyst-lenses.yaml)。不得按人名或关键词自动选择；零个视角是正常结果。

## 使用框架

- 经济走向：`BF-MF-01.macro_state`。
- 政策立场：组合 `BF-PI-01` 的政策事实/执行与 `BF-MF-01` 的实际金融条件；不得把表态或单次工具操作当成有效立场已经改变。
- 实体资金：`BF-MF-01.financial_condition_transmission`。
- A股市场资金：`BF-EF-01.market_funding_state`；行业与风格映射需要进一步通过 `BF-EF-01.industry_style_exposure`。
- 公司收入、利润、现金、预期差和估值继续交给相应下游框架，本 Skill 不替代它们。

## 工作方式

1. 固定 A 股市场范围、研究期限、信息截面和目标对象；不得用事后修订数据回答历史时点问题。
2. `screen` 对三问各形成一条有证据边界的判断，并评估其对目标的相关性。只有相关性足以改变方向、幅度、时点、风险或证伪条件时才深挖。
3. `deep` 为每一条重要轴线选择最短充分路线、主要竞争解释和停止条件；无关模块必须裁剪。
4. 三问分别裁决，最后只报告一致、背离或不确定。禁止加权求和成单一“宏观分数”。
5. 仅在传导机制和当前横截面证据同时成立时映射行业或风格；不得从宏观直接推出个股业绩、资产价格、仓位或交易时点。
6. 已选分析师视角只生成候选主解释、竞争解释或监测信号。正式结论继续由原有证据、推理和框架门槛裁决，不给视角投票权重。

## 输出合同

交付 `macro_context`，至少包含：

```yaml
macro_context:
  as_of: <信息截面>
  horizon: <研究期限>
  mode: screen | deep
  economic_direction:
    conclusion: improving | stable | weakening | mixed | unknown
    confidence: high | medium | low
    state_axes: []
    decisive_evidence_refs: []
    competing_explanation: <主要竞争解释>
  policy_stance:
    conclusion: supportive | neutral | restrictive | mixed | unknown
    confidence: high | medium | low
    signal_execution_gap: <信号、工具、执行和有效立场的差异>
    evidence_layers: []
    decisive_evidence_refs: []
  funding_conditions:
    entity_financing:
      conclusion: loose | balanced | tight | mixed | unknown
      confidence: high | medium | low
      evidence_dimensions: []
    equity_market:
      conclusion: loose | balanced | tight | mixed | unknown
      confidence: high | medium | low
      evidence_channels: []
      net_equity_supply_checked: false
      balance_or_stock_checked: false
    decisive_evidence_refs: []
  regime_synthesis:
    alignment: aligned | divergent | uncertain
    target_materiality: high | medium | low
    industry_style_map: []
    transmission_limits: []
  stop_conditions: []
  monitoring_triggers: []
  downstream_handoffs: []
```

`conclusion` 只能表达当前证据支持的状态，不能替代正文中的范围、时钟和限制。三轴背离或证据不足时保留 `divergent` / `uncertain`，不得强行选方向。

## 数据与证据边界

遵守 `研究能力/data_sources.yaml`。外部金融数据工具只用于发现和取得候选数据；正式事实必须保留原始来源、口径、日期和定位。官方统计、央行/财政/监管文件、交易所和法定披露优先。成交额、ETF 流量、单类投资者流向、价格或情绪均为软指标，单独不能提高判断等级。
