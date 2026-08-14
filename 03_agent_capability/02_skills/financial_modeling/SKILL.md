---
skill_id: financial-modeling
name: Financial Modeling
version: 1.0.0
purpose: 构建可审计的结构化历史财务、驱动式预测、三表、情景与敏感性模型。
consumes: [evidence_package, normalized_financials, research_lens]
output_kind: financial_model
resources: [references/, ../../../contracts/financial_model_artifact_contract.yaml]
typed_io:
  input: {required: [normalized_financials, evidence_package, research_lens, as_of]}
  output: {kind: financial_model, required: [assumptions, formula_dependencies, scenarios, computed_outputs, reconciliations, audit]}
permissions: [read_verified_evidence, deterministic_calculation, create_candidate_artifact]
failure_states: [missing_basis, missing_unit, missing_period, circular_dependency, reconciliation_failed]
cost_budget: 3
latency_budget_ms: 90000
degradation: block_valuation_and_return_model_gaps
progressive_loading: metadata_then_instructions_then_resources
---

# Financial Modeling

## 程序

1. 先规范化历史财务：主体、asOf、会计口径、币种、单位、期间、重述状态均为必填。
2. 将历史边界与预测边界显式分开；预测只来自冻结假设、公司指引或情景。
3. 建立驱动、公式依赖和三表勾稽；记录稀释股本、一次性项目和调整口径。
4. 为 base/bull/bear 保存独立假设与敏感性，不用格式化表格替代结构化模型。
5. 运行确定性模型审计；审计未通过的模型不得进入估值。

## 不做

- 不猜测缺失单位、币种、期间或会计口径。
- 不使用 asOf 之后的信息。
- XLSX 仅可作为结构化 financial_model 的可编辑投影，不是权威来源。

按需读取 references/modeling-checklist.md 和正式制品合同。
