# 研究设计评审合同

## 语义

`design_review` 只判断研究是否可以进入取证。它不证明任何结论成立，也不补写事实、来源或投资判断。`pass` 的含义是问题、边界、假设与证据方案已经足以启动研究。

## 输出

顶层只能包含 `design_review`：

```yaml
design_review:
  verdict: pass | needs_revision | block
  research_question: "可回答的研究问题"
  decision_use: "立项、配置、竞争判断、政策研判、技术路线、投资命题、复盘等"
  output_boundary: "允许交付什么，不允许交付什么"
  information_cutoff: YYYY-MM-DDTHH:MM:SS+08:00
  object_scope:
    subject: "研究对象"
    geography: "地区或市场"
    time_window: "业务窗口或验证窗口"
    unit_of_analysis: "公司、行业、产品、政策、资产等"
  main_hypothesis:
    id: H1
    statement: "主假设"
    observable_predictions:
      - "若主假设成立，应观察到什么"
  competing_hypotheses:
    - id: C1
      statement: "竞争解释"
      observable_predictions:
        - "若竞争解释成立，应观察到什么"
  evidence_plan:
    - role: primary | baseline | mechanism | cross_check | counter
      evidence_question: "这组证据要回答什么"
      source_strategy: "优先查哪些来源、口径或材料"
      required: true
  decisive_disconfirmers:
    - "足以推翻或降级主假设的观察"
  key_risks:
    - risk_type: reverse_causality | common_cause | definition_drift | timing_mismatch | sample_bias | authorization | other
      description: "风险为何影响研究可靠性"
      mitigation: "如何在取证或推理中处理"
  stop_conditions:
    - "何时停止研究、降级输出或要求人工确认"
  minimum_revision_items:
    - "verdict 不是 pass 时必须列出最小修改项"
```

## 一致性门槛

- `pass` 必须有可回答的 `research_question`、明确 `decision_use`、冻结的 `object_scope`、主假设、至少一条竞争假设、证据方案、决定性反证和停止条件。
- `pass` 的 `evidence_plan` 必须至少覆盖 `primary` 与 `counter`，并至少覆盖 `baseline`、`mechanism`、`cross_check` 中的一类。
- 每条主假设和竞争假设都必须有 `observable_predictions`，否则无法在取证后区分。
- `needs_revision` 与 `block` 必须列出 `minimum_revision_items`。
- 不得输出买卖、仓位、目标价、收益承诺、下单执行或未授权择时字段。
