// GENERATED FILE. DO NOT EDIT.
// Source: 05_control_evaluation/01_rules/policies/source_document_attestation_policy.yaml
// Regenerate: python3 scripts/generate-source-document-attestation-rules.py

export const SOURCE_DOCUMENT_ATTESTATION_RULES = {
  "attestation": {
    "capture_body_relation": "excerpt_or_normalized_metadata",
    "fields": [
      "raw_content_hash",
      "byte_length",
      "mime_type"
    ],
    "hash_algorithm": "sha256",
    "hash_pattern": "^sha256:[a-f0-9]{64}$",
    "invariants": [
      "完整原始文件哈希不得替代摘录 body 的 content_hash；二者分别校验。",
      "摘录 quote 仍必须逐字定位于 capture.body；文件指纹不替代定位。",
      "文件指纹只证明取得的字节版本可复验，不证明发布主体陈述为真。",
      "不得将原始文件字节自动发送给外部模型；模型出境仍由 model_data_egress_policy.yaml 决定。",
      "若声明了完整文件指纹，三个字段必须同时存在并符合格式；不完整声明必须拒绝。"
    ],
    "mime_types": [
      "application/pdf",
      "text/html",
      "text/plain",
      "application/json",
      "application/xml"
    ],
    "minimum_byte_length": 1,
    "optional_for": [
      "ordinary_researcher_excerpt",
      "connector_excerpt"
    ],
    "required_for": [
      "formal_evaluation_evidence_with_public_document_claim"
    ]
  },
  "authority": "control_policy",
  "governance": {
    "source_of_truth": "05_control_evaluation/01_rules/policies/source_document_attestation_policy.yaml",
    "tests": [
      "06_runtime/tests/source-result-adapter.test.ts",
      "06_runtime/tests/researcher-material.test.ts",
      "06_runtime/tests/formal-case-eligibility.test.ts"
    ],
    "validator": "05_control_evaluation/04_verifiers/validate_source_document_attestation_policy.py"
  },
  "purpose": "允许研究在不把原始 PDF/HTML 直接放入 Runtime、Artifact 或模型上下文的前提下， 保存可复验的完整原始文件指纹。短摘录哈希与完整原始文件哈希必须分开，禁止混称。",
  "rule_ids": [
    "GOV-SOURCE-DOCUMENT-ATTESTATION-001"
  ],
  "runtime_projection": {
    "formal_case_eligibility": "06_runtime/src/evaluation/formal-case-eligibility.ts",
    "generated_projection": "06_runtime/src/tools/generated/source-document-attestation-rules.ts",
    "local_preparer": "06_runtime/scripts/prepare-public-document-material.ts",
    "normalizer": "06_runtime/src/tools/source-document-attestation.ts",
    "projection_generator": "06_runtime/scripts/generate-source-document-attestation-rules.py",
    "provenance_store": "06_runtime/src/semantic/provenance-store.ts",
    "provenance_verifier": "06_runtime/src/governance/provenance-verifier.ts",
    "source_result_adapter": "06_runtime/src/tools/source-result-adapter.ts"
  },
  "schema_name": "source_document_attestation_policy",
  "schema_version": "1.0.0",
  "scope": "公开或经授权来源的可定位摘录与完整原始文件指纹绑定",
  "status": "active"
} as const;
