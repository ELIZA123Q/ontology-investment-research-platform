---
skill_id: company-fundamental-research
name: Company Fundamental Research
version: 1.0.0
purpose: 将 A 股公司的商业模式、KPI、竞争优势和财务传导组织为可证伪的研究输入。
consumes: [research_plan, evidence_package, research_lens]
output_kind: hypothesis_map
resources: [references/]
typed_io:
  input: {required: [research_plan, evidence_package, research_lens, company_identity, as_of]}
  output: {kind: hypothesis_map, required: [business_model, key_kpis, financial_bridge, competing_explanations, evidence_gaps, change_signals]}
permissions: [read_verified_evidence, read_semantic_catalog, create_candidate_artifact]
failure_states: [missing_company_identity, missing_as_of, insufficient_evidence, inconsistent_financial_basis]
cost_budget: 4
latency_budget_ms: 120000
degradation: return_explicit_gaps_without_formal_judgment
progressive_loading: metadata_then_instructions_then_resources
---

# Company Fundamental Research

## 程序

1. 冻结公司主体、报告期、会计口径和主/反 research lens。
2. 拆解商业模式、收入/成本/资本开支 KPI、竞争位置与治理。
3. 将经营变量连接到收入、利润、现金流和资产负债表；每条链路绑定证据或缺口。
4. 列出至少一个竞争解释和可观察的改判信号。
5. 输出公司命题输入；正式判断仍由 judgment-reasoning 与 Research Lead 完成。

## 不做

- 不把管理层叙述直接当作事实。
- 不估算评级、目标价、仓位或交易指令。
- 不以“公司全景介绍”替代明确命题。

按需读取 references/company-coverage-contract.md。
