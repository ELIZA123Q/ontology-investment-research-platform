# 论证与语言编辑合同

## 语义

`argument_language_edit` 只处理表达质量和论证边界。它可以降级、删除或重写越界表达，但不得补造证据、提高置信度、替代研究判断或把 `needs_revision`、`block` 包装成可交付结论。

## 输出

顶层只能包含 `argument_language_edit`：

```yaml
argument_language_edit:
  edit_status: clean | edited | needs_producer_revision | block
  source_artifact_ref: report:example
  replacement_text: "可直接替换的全文或关键段落；若不适用写 not_applicable"
  paragraph_edits:
    - location: "章节、段落或 claim ref"
      original_text: "原文"
      revised_text: "修订文"
      edit_reason: "事实/推断/判断分离、语言降级、逻辑澄清等"
  downgraded_claims:
    - location: "章节、段落或 claim ref"
      original_text: "原强表达"
      revised_text: "降级后的表达"
      reason: "缺少因果识别、预期基线、独立证据或授权边界"
  boundary_violations:
    - location: "章节、段落或 claim ref"
      violation_type: causal_overclaim | expectation_without_baseline | unsupported_certainty | trading_advice | target_price | return_promise | evidence_gap | mixed_fact_judgment | other
      severity: high | medium | low
      required_action: remove | downgrade | producer_revision | validation_block
  needs_producer_revision:
    - "必须由研究生产者补证、改判或重跑流程的问题"
  protected_judgment_thresholds:
    - "编辑者不得擅自降低或提高的判断门槛"
  final_validation_required: true
```

## 一致性门槛

- `clean` 与 `edited` 必须提供 `replacement_text` 或 `paragraph_edits`，以便产物可落地。
- `needs_producer_revision` 与 `block` 必须列出 `needs_producer_revision`。
- 发现 `trading_advice`、`target_price` 或 `return_promise` 时，不得给出 `clean`。
- 若 `boundary_violations.required_action` 包含 `producer_revision` 或 `validation_block`，`edit_status` 必须是 `needs_producer_revision` 或 `block`。
- `final_validation_required` 必须为 `true`；语言编辑不能替代最终成品验证。
