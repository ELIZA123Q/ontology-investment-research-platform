---
skill_id: valuation-analysis
name: Valuation Analysis
version: 1.0.0
purpose: 在已审计模型和冻结输入基础上形成可比、DCF/SOTP 与敏感性估值区间。
consumes: [financial_model, normalized_financials, evidence_package]
output_kind: valuation_analysis
resources: [references/]
typed_io:
  input: {required: [audited_financial_model, normalized_financials, evidence_package, as_of]}
  output: {kind: valuation_analysis, required: [methods, assumptions, sensitivities, status]}
permissions: [read_verified_evidence, deterministic_calculation, create_candidate_artifact]
failure_states: [model_audit_failed, missing_as_of, missing_unit, unauthorized_market_input]
cost_budget: 3
latency_budget_ms: 90000
degradation: return_blocked_valuation_without_numeric_conclusion
progressive_loading: metadata_then_instructions_then_resources
---

# Valuation Analysis

## 程序

1. 确认 financial_model 审计通过、估值时点和市场数据 asOf。
2. 明确方法、可比选择、关键假设、输入来源、区间和敏感性。
3. 分别呈现可比、DCF 或 SOTP 的适用条件，不把不同口径机械平均。
4. 输出估值分析与假设敏感性，交由 Research Lead 在研究判断中使用。

## 不做

- 不自动产生评级、目标价、仓位或交易指令。
- 不在模型审计失败、缺少 asOf 或单位不明时输出数值结论。

按需读取 references/valuation-checklist.md。
