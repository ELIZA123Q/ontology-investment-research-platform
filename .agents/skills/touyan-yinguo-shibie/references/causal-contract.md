# 因果识别交接合同

## CausalDesign

```yaml
causal_question: ""
cause_a: ""
outcome_b: ""
unit_of_analysis: ""
scope: ""
business_window: ""
lag_hypothesis: ""
causal_estimand: ""
counterfactual: ""
candidate_structures:
  - relationship: forward_a_to_b | reverse_b_to_a | common_cause | bidirectional
    statement: ""
    directed_edges: []
    observable_predictions: []
    falsifier: ""
confounders: []
confounder_search: ""
mediators: []
colliders: []
identification_strategy: randomized_experiment | natural_experiment | difference_in_differences | regression_discontinuity | instrumental_variable | synthetic_control | event_study | exposure_comparison | process_tracing | observational_triangulation | descriptive_only
identification_assumptions: []
evidence_tasks:
  - task_ref: ""
    diagnostic_type: temporality | mechanism | exposure_contrast | reverse_direction | common_cause | negative_control | placebo | pretrend | robustness
    target_structure: ""
    question: ""
    evidence_roles: [primary, baseline, mechanism, cross_check, counter]
downgrade_if_missing: ""
```

必要结构是 `forward_a_to_b`、`reverse_b_to_a`、`common_cause`。必要任务是 `temporality`、`mechanism`、`exposure_contrast`、`reverse_direction`、`common_cause`。

## CausalAssessment

```yaml
design_ref: ""
relationship_conclusion: forward_a_to_b | reverse_b_to_a | common_cause | bidirectional | multiple_causes | association_only | unresolved
causal_status: identified | strongly_supported | partially_supported | consistent_only | not_identified | contradicted
diagnostics:
  - diagnostic_type: temporality | mechanism | exposure_contrast | reverse_direction | common_cause | negative_control | placebo | pretrend | robustness
    status: passed | weakened | rejected | inconclusive | not_applicable
    evidence_refs: []
    independent_source_groups: []
    explanation: ""
identification_assumptions_status: passed | partial | failed | not_tested
independent_source_groups: []
effect_estimate:
  estimate: 0.0
  unit: ""
  uncertainty_interval: ""
  sample_description: ""
  method: ""
  reproducible_artifact_ref: ""
directional_paths:
  - direction: forward_a_to_b | reverse_b_to_a
    lag: ""
    mediator: ""
    lag_evidence_refs: []
    mediator_evidence_refs: []
decisive_evidence_refs: []
unresolved_alternatives: []
limitations: []
claim_language_level: direct_causal | supported_causal | possible_contribution | association_only | unidentified | causal_rejection
conclusion_statement: ""
```

`effect_estimate` 仅在存在可复现的定量估计时填写；`identified` 必须填写。`directional_paths` 仅在双向关系中必填，须分别记录 A→B 与 B→A 的时滞、中介和证据。每个通过、削弱或拒绝的识别检查必须包含证据引用。共同原因结论的 `conclusion_statement` 必须说明 A、B 相关，但不支持 A 直接导致 B。
