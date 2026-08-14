// GENERATED FILE. DO NOT EDIT.
// Source: 05_control_evaluation/01_rules/policies/model_data_egress_policy.yaml
// Regenerate: python3 scripts/generate-model-data-egress-rules.py

export const MODEL_DATA_EGRESS_RULES = {
  "aggregation": {
    "input_scope": "all_supplied_source_references",
    "no_source_behavior": "private_authorized",
    "precedence": [
      "restricted_no_egress",
      "private_authorized",
      "public"
    ],
    "rationale": "任何可能进入提示上下文的来源均参与最严格策略聚合；未知权限不得被默认为可出境。",
    "required_source_missing_behavior": "restricted_no_egress"
  },
  "authority": "control_policy",
  "governance": {
    "gateway_enforcer": "06_runtime/src/providers/model-gateway.ts",
    "generated_projection": "06_runtime/src/providers/generated/model-data-egress-rules.ts",
    "policy_resolver": "06_runtime/src/providers/model-data-policy.ts",
    "projection_generator": "06_runtime/scripts/generate-model-data-egress-rules.py",
    "source_of_truth": "05_control_evaluation/01_rules/policies/model_data_egress_policy.yaml",
    "tests": [
      "06_runtime/tests/model-data-policy.test.ts",
      "06_runtime/tests/model-data-egress-rules-projection.test.ts",
      "06_runtime/tests/model-gateway.test.ts"
    ]
  },
  "policies": {
    "private_authorized": {
      "external_provider_allowed": true
    },
    "public": {
      "external_provider_allowed": true
    },
    "restricted_no_egress": {
      "allowed_provider_deployments": [
        "local"
      ],
      "external_provider_allowed": false
    }
  },
  "purpose": "将证据权限映射为模型上下文的最严格出境策略。它只控制数据能否交给何种模型， 不改变证据真实性、研究结论或任何来源的原始授权范围。",
  "rule_ids": [
    "GOV-MODEL-DATA-EGRESS-001"
  ],
  "schema_name": "model_data_egress_policy",
  "schema_version": "1.0.0",
  "scope": "外部模型调用前的证据数据出境分级与阻断",
  "source_permission_mapping": {
    "authorized_research_use": "private_authorized",
    "missing_permission_scope": "restricted_no_egress",
    "public_research_use": "public",
    "restricted": "restricted_no_egress",
    "user_supplied": "private_authorized"
  },
  "status": "active"
} as const;
