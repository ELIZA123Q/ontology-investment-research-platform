# 运行上下文合同

运行上下文是能力处理器与动态编排器之间的输入，不是本体，也不是证据规则的替代品。

## 顶层字段

```yaml
recorded_at: 2026-09-10T09:00:00+08:00
evidence:
  # 可提供外部评价上下文；实际图对象仍是正式门槛的依据。
  conflict_detected: false
reasoning:
  # 已由外部确定性规则引擎形成的评价数。
  rule_evaluation_count: 1
node_outputs:
  NODE_ID:
    - id: stable-object-id
      type: RuntimeType
      properties: {}
```

- `recorded_at`：本批运行对象的记录时间。
- `evidence`：规则评价所需的外部证据上下文。
- `reasoning`：外部规则执行结果摘要。
- `node_outputs`：按执行节点 ID 提供的已审阅对象列表。

## 最小证据链示例

```yaml
node_outputs:
  acquire:
    - id: source:example:1
      type: SourceDocument
      properties:
        title: 示例来源
        source_url: https://example.com/source
        publisher: 示例发布者
  extract:
    - id: claim:example:1
      type: EvidenceClaim
      properties:
        statement: 示例主张
        locator: source:example:1#section-2
  facts:
    - id: fact:example:1
      type: EvidenceFact
      properties:
        statement: 经准入的示例事实
        valid_time: 2026-09-01
  assess:
    - id: assessment:example:1
      type: EvidenceAssessment
      properties:
        assessment_status: complete
        lineage_complete: true
        ready_for_directional_judgment: true
  hypotheses:
    - id: hypothesis:example:1
      type: Hypothesis
      properties:
        statement: 待裁决假设
  reason:
    - id: rule-result:example:1
      type: RuleEvaluation
      properties:
        rule_id: domain-rule:example
        matched: true
  judgment:
    - id: judgment:example:1
      type: Judgment
      properties:
        statement: 有条件的研究判断
        judgment_level: J2
```

提供 `evidence_ready: true` 之类的状态只能改变规划时是否调用补证能力，不能凭空创建
`SourceDocument`、`EvidenceClaim`、`EvidenceFact` 或 lineage。正式对象必须以节点输出或已存图
对象存在，并通过相应机器规则。

`PublishedReport` 不应由调用者手工写入 `node_outputs`。发布能力必须读取草稿和由人类产生的
`ApprovalRecord`，然后生成带审批关联和 provenance 的正式报告对象。
