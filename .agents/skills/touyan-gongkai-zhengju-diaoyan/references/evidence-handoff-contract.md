# 证据交接合同

## 输入

```yaml
research_question: ""
information_cutoff: YYYY-MM-DDTHH:MM:SS+08:00
object_scope: ""
business_time: ""
judgment_types: []
evidence_method_refs: []
evidence_plan:
  - task_ref: evidence-task:example
    question: ""
    required_roles: [primary, baseline, counter]
    distinguishing_signal: ""
domain: null
```

若 `domain` 有已登记目录，加载行业目录、来源速查和 OPS；没有目录时不得按行业名猜测来源或口径。

## 输出

顶层只能包含 `evidence_handoff`。具体字段由 `ir_platform.evidence_handoff` 校验。

```yaml
evidence_handoff:
  information_cutoff: YYYY-MM-DDTHH:MM:SS+08:00
  task_refs: []
  sources:
    - id: source:example
      producer: ""
      title: ""
      source_type: official_primary | issuer_disclosure | direct_measurement | professional_secondary | news
      source_roles: [primary]
      publication_date: YYYY-MM-DD
      captured_at: YYYY-MM-DDTHH:MM:SS+08:00
      original_url: https://example.com/original
      access_method: ""
      version_or_period: ""
      independence_group: ""
      query_playbook_ref: ""
  claims:
    - id: claim:example
      task_ref: evidence-task:example
      statement: ""
      source_ref: source:example
      locator: "页码、表格、段落、时间戳或字段"
      business_time: ""
      scope: ""
      metric_definition: ""
      unit: "实际单位；非数值为 not_applicable"
      claim_kind: hard_fact | context | interpretation
      numeric: false
  observations: []
  calculations: []
  coverage_by_role:
    evidence-task:example:
      primary: covered
      baseline: covered
      counter: covered
  source_independence_groups:
    producer_data_chain: [source:example]
  conflicts: []
  counter_searches:
    - id: counter-search:example
      task_ref: evidence-task:example
      query: ""
      scope: ""
      searched_source_refs: []
      result: "在已记录的查询范围内发现／未发现什么"
      captured_at: YYYY-MM-DDTHH:MM:SS+08:00
  gaps: []
  completeness: sufficient | limited | observation | unusable
  stop_decision:
    continue_research: false
    reason: ""
    upgrade_evidence_needed: []
```

## 来源类型

- `official_primary`：政府、监管、交易所、法律规则和正式统计生产者原文。
- `issuer_disclosure`：发行人法定披露、正式经营数据和可定位说明会材料。
- `direct_measurement`：说明对象、样本和方法的专业直接测量。
- `professional_secondary`：行业研究与专业解释，可作上下文或竞争解释，不能单独生成硬事实。
- `news`：事件发现和公开叙事，不单独生成硬事实。
- `search_result`、`ai_summary`：只用于发现；若被主张引用，校验必须失败。

## 结构化缺口

`gap_type` 使用：`access_denied`、`channel_error`、`field_unavailable`、`scope_mismatch`、`time_mismatch`、`trace_missing`、`method_opaque`、`source_not_found`、`domain_measurement_missing`。

任何 `partial` 或 `missing` 角色都必须有同任务、同角色的缺口记录。缺口写实际尝试和对可用范围的影响，不写估计值替代缺失事实。
