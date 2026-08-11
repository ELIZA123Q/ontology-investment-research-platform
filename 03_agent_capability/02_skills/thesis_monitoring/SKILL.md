---
skill_id: thesis-monitoring
name: Thesis Monitoring
version: 1.0.0
purpose: 版本化维护研究命题支柱、信号、催化剂、失效条件和未决证据。
consumes: [judgment, evidence_package, financial_model, valuation_analysis]
output_kind: thesis_state
resources: [references/]
progressive_loading: metadata_then_instructions_then_resources
---

# Thesis Monitoring

## 程序

1. 以 ResearchCase 为边界，创建不可覆盖的 thesis_state 版本。
2. 对每条 pillar 记录支持、削弱或阻断信号及其 EvidenceFact 引用。
3. 记录下一催化剂、观察窗口、失效条件、未决证据和模型/估值影响。
4. 只描述状态变化；正式改判仍需 judgment-reasoning 与审批。

## 不做

- 不静默改写历史 thesis_state。
- 不把未核验证据升级为信号。

按需读取 references/thesis-state-contract.md。
