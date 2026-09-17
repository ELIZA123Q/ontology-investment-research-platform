# 决策比较合同

## 语义

本合同只比较研究载体。`selection_edge` 专指个股选择相对 ETF 的可验证增量，`candidate_ranking` 是研究优先级而非交易排序。所有 `evidence_refs` 可引用事实、计算或结构化缺口，但必须能由上游研究追溯。

## 输出

顶层只能包含 `decision_comparison`：

```yaml
decision_comparison:
  information_cutoff: YYYY-MM-DDTHH:MM:SS+08:00
  a10_thesis_ref: judgment:A10:example
  a10_thesis_status: formed | conditional | watch | not_formed | blocked | expired | rewrite
  decision_question: "同一A10命题更适合由ETF、个股选择还是混合载体承接？"
  comparison_scope:
    asset_universe: "明确的A股及ETF范围"
    horizon: "与A10一致的验证期限"
    benchmark: "统一比较基准"
    common_dimensions:
      - id: exposure_coverage
        label: "命题暴露覆盖"
        comparison_basis: "同一时点、同一范围的可复核尺度"
      - id: fundamental_capture
        label: "基本面承接"
        comparison_basis: "同一时点、同一范围的可复核尺度"
      - id: expectation_gap
        label: "预期差"
        comparison_basis: "同一时点、同一范围的可复核尺度"
      - id: valuation
        label: "估值"
        comparison_basis: "同一时点、同一范围的可复核尺度"
      - id: downside_risk
        label: "下行风险"
        comparison_basis: "同一时点、同一范围的可复核尺度"
      - id: implementability
        label: "实施摩擦"
        comparison_basis: "同一时点、同一范围的可复核尺度"
  preferred_vehicle: etf | stock_selection | hybrid | insufficient
  preferred_vehicle_rationale: "只陈述相对适配性"
  selection_edge: strong | moderate | weak | unknown
  selection_edge_basis:
    - dimension: fundamental_dispersion | expectation_dispersion | valuation_dispersion | risk_dispersion | index_coverage_gap | governance_quality | price_performance | turnover
      statement: "可证伪的相对差异"
      evidence_refs: [claim:example]
      independent_source_groups: [issuer_chain]
  industry_dispersion:
    level: high | medium | low | unknown
    dimensions: ["分化体现在哪些经营或风险变量"]
    evidence_refs: [claim:example]
  etf_analysis:
    candidates:
      - object_ref: etf:example
        name: "ETF名称"
        index_or_strategy: "跟踪指数或规则"
        exposure_coverage: "覆盖与稀释情况"
        concentration_risks: ["集中度或结构风险"]
        replication_or_tracking: "复制、跟踪或口径限制"
        evidence_refs: [claim:example]
    coverage_gaps: ["未覆盖或无法核实之处；无则写 none_identified"]
  stock_categories:
    - category_ref: stock-category:example
      name: "候选类别"
      definition: "类别边界"
      advantage_hypothesis: "相对ETF的可验证承接优势"
      inclusion_rule: "事前、可观察的纳入规则"
      evidence_refs: [claim:example]
  candidate_ranking:
    - rank: 1
      object_ref: etf:example
      name: "候选对象"
      object_type: etf | stock
      category_ref: not_applicable
      dimension_assessments:
        - dimension_ref: exposure_coverage
          assessment: favorable | neutral | unfavorable | unknown
          value_or_band: "数值、可复核档位或 unknown"
          evidence_refs: [claim:example]
      advantage_statement: "研究优先级理由"
      decisive_risks: ["决定性风险"]
      evidence_refs: [claim:example]
  decisive_tradeoffs:
    - topic: "决定性取舍"
      favors: etf | stock_selection | hybrid | neither
      explanation: "为何改变载体适配性"
      evidence_refs: [claim:example]
  invalidation_conditions:
    - condition: "当前比较结论失效的条件"
      observable_signal: "可观察信号"
      deadline: "期限或事件窗口"
      consequence: downgrade_to_etf | downgrade_to_stock_selection | downgrade_to_hybrid | downgrade_to_insufficient | reassess
      evidence_refs: [claim:example]
  confidence: high | medium | low
  limitations: ["仍影响比较的限制"]
  report_boundary:
    conclusion_level: research_vehicle_comparison
    prohibited_outputs:
      - buy_sell_instruction
      - position_or_allocation
      - order_execution
      - target_price
      - return_promise
      - market_timing
```

## 一致性门槛

- `common_dimensions` 必须且只能各出现一次；六个规定维度均不可缺少。每个候选对象必须逐一使用完全相同的维度集合。
- 非 `insufficient` 结论至少比较一个 ETF 和一个股票对象；ETF对象必须登记于 `etf_analysis`，股票对象必须引用已登记的 `stock_categories`。
- `stock_selection` 或 `hybrid` 要求 `selection_edge` 为 `strong` 或 `moderate`；`etf` 只能对应 `weak` 或 `unknown`；`insufficient` 对应 `unknown` 与 `low` 置信度。
- `strong` 或 `moderate` 至少有两个不同的优势维度，其中至少一个不能是涨幅或成交；`strong` 还须覆盖至少两个独立来源组。
- A10 为 `not_formed`、`blocked`、`expired` 或 `rewrite` 时，必须停止为 `insufficient`。
- 任何未取得的比较信息写为 `unknown` 并引用缺口，不用零值或主观分数替代。
