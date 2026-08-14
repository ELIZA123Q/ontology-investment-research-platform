// GENERATED FILE. DO NOT EDIT.
// Source: 05_control_evaluation/01_rules/policies/signal_evidence_admission_policy.yaml
// Regenerate: python3 scripts/generate-signal-evidence-admission-rules.py

export const SIGNAL_EVIDENCE_ADMISSION_RULES = {
  "authority": "control_policy",
  "capture_requirement": {
    "accepted_capture_paths": [
      "authenticated_connector_source_capture",
      "researcher_submitted_located_excerpt"
    ],
    "point_in_time_fields": [
      "requested_at",
      "retrieved_at",
      "published_at",
      "business_time",
      "raw_response_fingerprint"
    ],
    "primary_link_behavior": "primary_link_is_a_lead_not_a_captured_source",
    "quote_must_be_locatable_in_body": true,
    "required_before_evidence_evaluation": true,
    "required_fields": [
      "source_uri",
      "title",
      "publisher_id",
      "published_at",
      "locator",
      "quote",
      "body",
      "permission_scope",
      "content_hash"
    ],
    "secondary_link_behavior": "secondary_link_is_a_lead_not_a_captured_source",
    "source_type_must_be_declared": true
  },
  "governance": {
    "generated_projection": "06_runtime/src/tools/generated/signal-evidence-admission-rules.ts",
    "projection_generator": "06_runtime/scripts/generate-signal-evidence-admission-rules.py",
    "runtime_consumer": "06_runtime/src/tools/signal-evidence-admission.ts",
    "source_of_truth": "05_control_evaluation/01_rules/policies/signal_evidence_admission_policy.yaml",
    "tests": [
      "06_runtime/tests/signal-evidence-admission.test.ts",
      "05_control_evaluation/04_verifiers/tests/test_signal_evidence_admission_policy.py"
    ],
    "validator": "05_control_evaluation/04_verifiers/validate_signal_evidence_admission_policy.py"
  },
  "purpose": "信号连接器用于发现与排序候选材料，不是证据生产者。公告标题、新闻摘要、 链接和连接器返回的片段不能直接成为 SourceSnapshot、EvidenceFact 或 Judgment。 只有重新取得并冻结可定位的原文快照后，材料才可进入后续证据评估。",
  "research_workflow": {
    "allowed_next_actions": [
      "capture_primary_original",
      "submit_located_excerpt",
      "record_access_gap",
      "dismiss_signal"
    ],
    "prohibited_next_actions": [
      "direct_evidence_ingestion_from_signal_payload",
      "direct_judgment_update"
    ],
    "required_task_state": "capture_required",
    "use_in_research_action": "create_or_reuse_evidence_only_task"
  },
  "rule_ids": [
    "GOV-SIGNAL-EVIDENCE-ADMISSION-001"
  ],
  "schema_name": "signal_evidence_admission_policy",
  "schema_version": "1.0.0",
  "scope": "公开新闻与公告信号进入研究证据链的准入边界",
  "signal_payload": {
    "allowed_uses": [
      "discovery",
      "ranking",
      "researcher_notification",
      "capture_request"
    ],
    "prohibited_promotions": [
      "source_snapshot",
      "evidence_fact",
      "judgment",
      "financial_observation"
    ],
    "usable_as_evidence": false
  },
  "status": "active"
} as const;
