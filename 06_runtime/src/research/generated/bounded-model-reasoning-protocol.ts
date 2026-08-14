// GENERATED FILE. DO NOT EDIT.
// Source: 03_agent_capability/02_skills/judgment_reasoning/references/bounded-model-reasoning-protocol.yaml
// Regenerate: python3 scripts/generate-bounded-model-reasoning-protocol.py

export const BOUNDED_MODEL_REASONING_PROTOCOL = {
  "allowed_targets": [
    "hypothesis",
    "judgment",
    "independent_review"
  ],
  "authority": "reusable_research_method",
  "deterministic_output_screen": {
    "prohibited_investment_terms": [
      "买入",
      "卖出",
      "增持",
      "减持",
      "目标价",
      "保证收益",
      "稳赚"
    ],
    "unauthorized_reference_behavior": "reject",
    "unsupported_numeric_behavior": "reject"
  },
  "governance": {
    "drift_validator": "05_control_evaluation/04_verifiers/validate_bounded_model_reasoning_protocol.py",
    "evaluation_replay": "06_runtime/tests/model-reasoning.test.ts",
    "release_boundary": "仅约束既有 judgment-reasoning 基线的模型候选路径；不激活任何候选 Skill 或 Agent。",
    "source_of_truth": "03_agent_capability/02_skills/judgment_reasoning/references/bounded-model-reasoning-protocol.yaml"
  },
  "hard_rules": [
    "EvidenceFact 的核验状态已由确定性链路决定，不得修改、推翻或伪造。",
    "只能引用输入中提供的 EvidenceFact ID 和 Artifact ID；不得新造事实、数值、来源、引用或对象。",
    "必须给出竞争假设与可观察的证伪条件；证据不足时应返回空候选或 null judgment。",
    "模型判断只是一份候选表达；正式判断、证据门和写权限由 Runtime 与研究员审批决定。",
    "不得输出评级、目标价、交易、仓位、买卖建议或保证收益。",
    "independent_review 仅报告可定位缺陷，不得改写任何主制品或隐藏推理。"
  ],
  "input_contract": {
    "artifacts": {
      "allowed_fields": [
        "id",
        "kind",
        "title",
        "status",
        "data"
      ],
      "allowed_kinds": [
        "method_application",
        "evidence_package",
        "hypothesis_map",
        "financial_model",
        "valuation_analysis",
        "thesis_state",
        "report"
      ]
    },
    "evidence_facts": {
      "allowed_fields": [
        "id",
        "statement",
        "fact_type",
        "business_time",
        "existing_evidence_roles"
      ],
      "required_status": "verified"
    },
    "source_policy": "由 Model Gateway 按全部 SourceReference 与 EvidenceFact 快照权限聚合；不得由本协议放宽。"
  },
  "output_contract": {
    "candidate_only": true,
    "evidence_assignments": {
      "allowed_roles": [
        "support",
        "weaken",
        "block",
        "context"
      ],
      "requires_fact_id": true,
      "requires_rationale": true
    },
    "hypotheses": {
      "maximum": 5,
      "requires_distinguishing_signals": true,
      "requires_fact_ids": true,
      "requires_falsification_conditions": true
    },
    "judgment": {
      "formal_commit_owner": "Runtime_and_researcher_approval",
      "optional": true,
      "requires_change_conditions": true,
      "requires_fact_ids": true
    },
    "review_findings": {
      "allowed_severities": [
        "critical",
        "major",
        "minor"
      ],
      "maximum": 12,
      "requires_artifact_refs": true
    }
  },
  "protocol_id": "KB04-BOUNDED-MODEL-REASONING-001",
  "protocol_version": "1.0.0",
  "purpose": "将模型的研究性贡献限制为证据角色映射、竞争假设、候选判断表达与缺陷发现。 本协议不赋予模型事实核验、数值计算、证据真实性裁决、正式写入或投资建议权限。",
  "runtime_projection": {
    "consumer": "06_runtime/src/research/model-reasoning.ts",
    "generated_projection": "06_runtime/src/research/generated/bounded-model-reasoning-protocol.ts",
    "max_output_tokens": 2400,
    "projection_generator": "06_runtime/scripts/generate-bounded-model-reasoning-protocol.py",
    "prompt_version": "bounded-research-reasoning/1.1.0",
    "schema_version": "bounded-research-reasoning/1.0.0",
    "system_instruction": "你是受约束的专业投研推理组件。你只能在提供的已核验事实与授权制品内形成候选分析；正式性、证据门和写权限由 Runtime 决定。只输出 JSON。"
  },
  "schema_name": "bounded_model_reasoning_protocol",
  "schema_version": "1.0.0",
  "scope": "已核验 EvidenceFact 与经授权 Artifact 上的模型候选推理；适用于假设、判断草拟和独立复核。",
  "status": "active",
  "target_instructions": {
    "hypothesis": "对同一组已核验事实提出主假设与竞争解释，并说明哪些观察可以区分它们。",
    "independent_review": "只报告可复现缺陷，优先检查来源权限、时间、数值、口径、反证和叙事强度。",
    "judgment": "只在输入事实足以支撑候选措辞时草拟判断；否则返回 null judgment 并陈述缺口。"
  }
} as const;
