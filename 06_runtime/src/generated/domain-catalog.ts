// Generated from 01-05 definition authorities by scripts/generate-domain-catalog.py.
// Do not edit: update the owning 01-05 file and run npm run domain:sync.
export const DOMAIN_CATALOG = {
  "capabilities": {
    "agents": {
      "agents": [
        {
          "agent_id": "research-lead",
          "can_assume_roles": [
            "research_lead"
          ],
          "context_policy": "conversation",
          "execution_contract": {
            "allowed_skills": "all_released_for_scope",
            "allowed_tools": [
              "semantic.search",
              "source.discover",
              "source.capture",
              "source.query",
              "financial.model.validate",
              "artifact.publish"
            ],
            "can_delegate_to": [
              "evidence-investigator",
              "financial-modeler",
              "analysis-specialist",
              "independent-critic"
            ],
            "writable_artifact_kinds": [
              "research_plan",
              "research_problem_graph",
              "method_application",
              "evidence_package",
              "hypothesis_map",
              "judgment",
              "report",
              "review",
              "normalized_financials",
              "financial_model",
              "valuation_analysis",
              "thesis_state",
              "ui_surface"
            ]
          },
          "lifecycle": "active",
          "package": "03_agent_capability/01_agents/research_lead",
          "role": "唯一面向用户；理解目标、编译受约束任务图、控制预算、委派、形成最终判断和交付"
        }
      ],
      "candidates": [
        {
          "activation_gate": "至少 12 个可比案例盲评胜率不低于 60%，且证据覆盖提升至少 10 个百分点或中位耗时下降至少 20%；严重来源、时间旅行、公式或权限回归为 0",
          "agent_id": "evidence-investigator",
          "can_assume_roles": [
            "evidence_investigator"
          ],
          "execution_contract": {
            "allowed_skills": [
              "evidence-research"
            ],
            "allowed_tools": [
              "semantic.search",
              "source.discover",
              "source.capture",
              "source.query"
            ],
            "can_delegate_to": [],
            "context_policy": "delegated_slice",
            "writable_artifact_kinds": [
              "evidence_package"
            ]
          },
          "lifecycle": "planned",
          "notes": "只接收证据切片，只能写 evidence_package；首期先 shadow/forward test，不进入自动调度",
          "rollout": "evaluation_ready_worker"
        },
        {
          "activation_gate": "至少 12 个可比案例盲评胜率不低于 60%，模型公式、口径、时间旅行和权限严重回归为 0",
          "agent_id": "financial-modeler",
          "can_assume_roles": [
            "financial_modeler"
          ],
          "context_policy": "delegated_slice",
          "execution_contract": {
            "allowed_skills": [
              "financial-modeling",
              "valuation-analysis"
            ],
            "allowed_tools": [
              "semantic.search",
              "source.query",
              "financial.model.validate"
            ],
            "can_delegate_to": [],
            "context_policy": "delegated_slice",
            "writable_artifact_kinds": [
              "normalized_financials",
              "financial_model",
              "valuation_analysis"
            ]
          },
          "lifecycle": "planned",
          "notes": "可写 normalized_financials、financial_model、valuation_analysis；不能批准 Judgment、评级或发布",
          "package": "03_agent_capability/01_agents/financial_modeler",
          "rollout": "evaluation_ready_worker"
        },
        {
          "activation_gate": "单 Agent 复杂推理失败案例达到启用门槛",
          "agent_id": "analysis-specialist",
          "can_assume_roles": [],
          "execution_contract": {
            "allowed_skills": [
              "research-design",
              "judgment-reasoning"
            ],
            "allowed_tools": [
              "semantic.search",
              "source.query"
            ],
            "can_delegate_to": [],
            "context_policy": "delegated_slice",
            "writable_artifact_kinds": [
              "method_application",
              "hypothesis_map"
            ]
          },
          "lifecycle": "planned"
        },
        {
          "activation_gate": "对植入关键缺陷的召回率至少 80%，错误阻断率不高于 10%，并证明相对确定性 Verifier 和人工复核的增量价值",
          "agent_id": "independent-critic",
          "can_assume_roles": [
            "independent_reviewer"
          ],
          "execution_contract": {
            "allowed_skills": [
              "independent-research-review"
            ],
            "allowed_tools": [
              "semantic.search",
              "financial.model.validate"
            ],
            "can_delegate_to": [],
            "context_policy": "isolated_review",
            "writable_artifact_kinds": [
              "review"
            ]
          },
          "lifecycle": "planned",
          "notes": "隔离上下文，只输出 review；不得读取生产 Agent 隐藏推理或静默改写主制品",
          "rollout": "evaluation_ready_worker"
        }
      ],
      "definition_authority": "03_agent_capability/01_agents",
      "execution_binding": "06_runtime/src/capabilities/registry.ts",
      "rules": [
        "vNext.1 只能自动调度 lifecycle=active 的 Agent；evaluation_ready_worker 仅用于 shadow、forward test 或人工批准的演练",
        "Role 定义在 02_scenario_task/04_roles；Agent 通过 can_assume_roles 声明可承担的责任位",
        "candidates 不进入 Runtime 可调度清单，直至升级为 agents 且 lifecycle=active",
        "专家 Agent 作为 manager-controlled worker，不接管用户对话",
        "禁止在本目录复制 AGENT.md prompt 正文",
        "内部节点执行不是 A2A handoff"
      ],
      "schema_name": "capability_agents_registry",
      "schema_version": "3.0.0",
      "status": "active"
    },
    "release": {
      "activationPolicy": {
        "candidateProductionDispatchAllowed": false,
        "maximumSevereRegressions": 0,
        "minimumBlindWinRate": 0.6,
        "minimumComparableCases": 12
      },
      "agents": [
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "唯一面向用户且受审批约束的 vNext 编排基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "research-lead",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "evidence-investigator",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "financial-modeler",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "analysis-specialist",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "independent-critic",
          "lifecycle": "candidate",
          "version": "1.0.0"
        }
      ],
      "productScope": "local-first-a-share-semiconductor-research",
      "releaseId": "capability-vnext-2026-08-11",
      "schemaName": "capability_release_manifest",
      "schemaVersion": "1.0.0",
      "skills": [
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "vNext 研究范围与任务定义基线；候选扩张期间保持生产稳定。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "research-framing",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "vNext 受约束任务图与方法路由基线；候选扩张期间保持生产稳定。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "research-design",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "vNext 证据来源、时态与权限治理基线；候选扩张期间保持生产稳定。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "evidence-research",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "vNext 受约束判断与弃权基线；候选扩张期间保持生产稳定。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "judgment-reasoning",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "vNext 引用溯源与受控交付基线；候选扩张期间保持生产稳定。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "research-delivery",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "company-fundamental-research",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "sector-cycle-research",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "financial-modeling",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "valuation-analysis",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "earnings-update",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "thesis-monitoring",
          "lifecycle": "candidate",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "evaluation"
          ],
          "id": "independent-research-review",
          "lifecycle": "candidate",
          "version": "1.0.0"
        }
      ],
      "status": "current",
      "tools": [
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "只读语义检索基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "semantic.search",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "受治理来源发现基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "source.discover",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "快照、哈希与权限留痕基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "source.capture",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "受治理来源查询基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "source.query",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "审批后发布与版本留痕基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "artifact.publish",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "activationEvidence": {
            "evaluatedAt": "2026-08-11T00:00:00.000Z",
            "rationale": "确定性财务完整性校验基线。",
            "type": "foundational_baseline"
          },
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "financial.model.validate",
          "lifecycle": "active",
          "version": "1.0.0"
        }
      ]
    },
    "skillContracts": {
      "company-fundamental-research": {
        "consumes": [
          "research_plan",
          "evidence_package",
          "research_lens"
        ],
        "cost_budget": 4,
        "degradation": "return_explicit_gaps_without_formal_judgment",
        "failure_states": [
          "missing_company_identity",
          "missing_as_of",
          "insufficient_evidence",
          "inconsistent_financial_basis"
        ],
        "latency_budget_ms": 120000,
        "name": "Company Fundamental Research",
        "output_kind": "hypothesis_map",
        "permissions": [
          "read_verified_evidence",
          "read_semantic_catalog",
          "create_candidate_artifact"
        ],
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "将 A 股公司的商业模式、KPI、竞争优势和财务传导组织为可证伪的研究输入。",
        "resources": [
          "references/"
        ],
        "skill_id": "company-fundamental-research",
        "typed_io": {
          "input": {
            "required": [
              "research_plan",
              "evidence_package",
              "research_lens",
              "company_identity",
              "as_of"
            ]
          },
          "output": {
            "kind": "hypothesis_map",
            "required": [
              "business_model",
              "key_kpis",
              "financial_bridge",
              "competing_explanations",
              "evidence_gaps",
              "change_signals"
            ]
          }
        },
        "version": "1.0.0"
      },
      "earnings-update": {
        "consumes": [
          "evidence_package",
          "financial_model",
          "thesis_state"
        ],
        "name": "Earnings Update",
        "output_kind": "thesis_state",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "比较实际值、公司指引、内部前值与有授权 vintage 的一致预期，并触发模型和命题更新。",
        "resources": [
          "references/"
        ],
        "skill_id": "earnings-update",
        "version": "1.0.0"
      },
      "evidence-research": {
        "allowed_tools": [
          "source.discover",
          "source.capture",
          "source.query",
          "semantic.search"
        ],
        "consumes": [
          "research-design outputs",
          "01_semantic_knowledge evidence ontology"
        ],
        "name": "Evidence Research",
        "output_kind": "evidence_package",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "提出证据需求、选择来源与获取通道、核验留痕、评估完整度并寻找反证。",
        "resources": [
          "references/",
          "templates/",
          "registry.yaml"
        ],
        "skill_id": "evidence-research",
        "version": "1.0.0"
      },
      "financial-modeling": {
        "consumes": [
          "evidence_package",
          "normalized_financials",
          "research_lens"
        ],
        "cost_budget": 3,
        "degradation": "block_valuation_and_return_model_gaps",
        "failure_states": [
          "missing_basis",
          "missing_unit",
          "missing_period",
          "circular_dependency",
          "reconciliation_failed"
        ],
        "latency_budget_ms": 90000,
        "name": "Financial Modeling",
        "output_kind": "financial_model",
        "permissions": [
          "read_verified_evidence",
          "deterministic_calculation",
          "create_candidate_artifact"
        ],
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "构建可审计的结构化历史财务、驱动式预测、三表、情景与敏感性模型。",
        "resources": [
          "references/",
          "../../../contracts/financial_model_artifact_contract.yaml"
        ],
        "skill_id": "financial-modeling",
        "typed_io": {
          "input": {
            "required": [
              "normalized_financials",
              "evidence_package",
              "research_lens",
              "as_of"
            ]
          },
          "output": {
            "kind": "financial_model",
            "required": [
              "assumptions",
              "formula_dependencies",
              "scenarios",
              "computed_outputs",
              "reconciliations",
              "audit"
            ]
          }
        },
        "version": "1.0.0"
      },
      "independent-research-review": {
        "consumes": [
          "artifact_manifest",
          "review_scope"
        ],
        "cost_budget": 3,
        "degradation": "block_release_and_report_missing_review_inputs",
        "failure_states": [
          "review_bundle_incomplete",
          "source_not_locatable",
          "model_isolation_broken",
          "permission_denied"
        ],
        "latency_budget_ms": 90000,
        "name": "Independent Research Review",
        "output_kind": "review",
        "permissions": [
          "read_review_bundle",
          "create_review_artifact"
        ],
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "在隔离上下文中检查来源越权、时间旅行、模型错误、遗漏反证和叙事偏见。",
        "resources": [
          "references/"
        ],
        "skill_id": "independent-research-review",
        "typed_io": {
          "input": {
            "required": [
              "artifact_manifest",
              "source_refs",
              "review_scope",
              "as_of"
            ]
          },
          "output": {
            "kind": "review",
            "required": [
              "findings",
              "severity",
              "evidence_locator",
              "blocking_recommendations",
              "false_positive_notes"
            ]
          }
        },
        "version": "1.0.0"
      },
      "judgment-reasoning": {
        "consumes": [
          "evidence-research outputs",
          "research-design method applications"
        ],
        "name": "Judgment Reasoning",
        "output_kind": "hypothesis_map",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "在合格证据上建立主假设、竞争解释、因果链、反证、情景与判断强度。",
        "resources": [
          "references/"
        ],
        "skill_id": "judgment-reasoning",
        "version": "1.0.0"
      },
      "research-delivery": {
        "consumes": [
          "judgment-reasoning outputs",
          "evidence-research packages"
        ],
        "name": "Research Delivery",
        "output_kind": "report",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "将已验证证据与判断组织为边界清晰的交付物（快答、研报、判断卡、图表、过程视图等）。",
        "resources": [
          "references/",
          "templates/"
        ],
        "skill_id": "research-delivery",
        "version": "1.0.0"
      },
      "research-design": {
        "consumes": [
          "02_scenario_task/03_tasks",
          "02_scenario_task/02_scenarios"
        ],
        "name": "Research Design",
        "output_kind": "method_application",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "面对这个 Task，选择研究框架、判断结构与证伪设计。",
        "resources": [
          "references/",
          "registry.yaml"
        ],
        "skill_id": "research-design",
        "version": "1.0.0"
      },
      "research-framing": {
        "consumes": [
          "02_scenario_task/01_intents",
          "02_scenario_task/03_tasks"
        ],
        "name": "Research Framing",
        "output_kind": "research_plan",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "明确这个问题到底在研究什么——对象、期限、决策目标、边界与必要澄清。",
        "skill_id": "research-framing",
        "version": "1.0.0"
      },
      "sector-cycle-research": {
        "consumes": [
          "research_plan",
          "evidence_package",
          "research_lens"
        ],
        "name": "Sector Cycle Research",
        "output_kind": "hypothesis_map",
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "用供需、库存、价格、产能与产业链证据判断周期位置，并映射到公司。",
        "resources": [
          "references/"
        ],
        "skill_id": "sector-cycle-research",
        "version": "1.0.0"
      },
      "thesis-monitoring": {
        "consumes": [
          "judgment",
          "evidence_package",
          "financial_model",
          "valuation_analysis"
        ],
        "cost_budget": 2,
        "degradation": "preserve_prior_version_and_record_gap",
        "failure_states": [
          "missing_research_case",
          "unapproved_judgment",
          "stale_evidence",
          "unresolved_invalidation"
        ],
        "latency_budget_ms": 60000,
        "name": "Thesis Monitoring",
        "output_kind": "thesis_state",
        "permissions": [
          "read_verified_evidence",
          "read_approved_judgment",
          "create_candidate_artifact"
        ],
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "版本化维护研究命题支柱、信号、催化剂、失效条件和未决证据。",
        "resources": [
          "references/"
        ],
        "skill_id": "thesis-monitoring",
        "typed_io": {
          "input": {
            "required": [
              "research_case",
              "judgment",
              "evidence_package",
              "as_of"
            ]
          },
          "output": {
            "kind": "thesis_state",
            "required": [
              "version",
              "pillars",
              "signals",
              "catalysts",
              "invalidation_conditions",
              "open_evidence_gaps"
            ]
          }
        },
        "version": "1.0.0"
      },
      "valuation-analysis": {
        "consumes": [
          "financial_model",
          "normalized_financials",
          "evidence_package"
        ],
        "cost_budget": 3,
        "degradation": "return_blocked_valuation_without_numeric_conclusion",
        "failure_states": [
          "model_audit_failed",
          "missing_as_of",
          "missing_unit",
          "unauthorized_market_input"
        ],
        "latency_budget_ms": 90000,
        "name": "Valuation Analysis",
        "output_kind": "valuation_analysis",
        "permissions": [
          "read_verified_evidence",
          "deterministic_calculation",
          "create_candidate_artifact"
        ],
        "progressive_loading": "metadata_then_instructions_then_resources",
        "purpose": "在已审计模型和冻结输入基础上形成可比、DCF/SOTP 与敏感性估值区间。",
        "resources": [
          "references/"
        ],
        "skill_id": "valuation-analysis",
        "typed_io": {
          "input": {
            "required": [
              "audited_financial_model",
              "normalized_financials",
              "evidence_package",
              "as_of"
            ]
          },
          "output": {
            "kind": "valuation_analysis",
            "required": [
              "methods",
              "assumptions",
              "sensitivities",
              "status"
            ]
          }
        },
        "version": "1.0.0"
      }
    },
    "skills": {
      "definition_authority": "03_agent_capability/02_skills",
      "execution_binding": "06_runtime/src/capabilities/registry.ts",
      "execution_contract_defaults": {
        "input_kinds": [
          "context_package"
        ],
        "rule": "所有 Skill 只接收经 04 Context 合同裁剪的输入；单个 Skill 可在 execution_contract 显式收紧，不得放宽。"
      },
      "method_assets": "03_agent_capability/02_skills/method_assets.yaml",
      "progressive_loading": "metadata_then_instructions_then_resources",
      "release_manifest": "03_agent_capability/releases/current.json",
      "rules": [
        "Skill 是程序性知识包，不是 Runtime 每一步代码",
        "方法资源属于对应 Skill package，不再使用 05_method_libraries 一级目录",
        "禁止按固定阶段把每个 Runtime 操作拆成 Skill",
        "禁止在 .claude/skills 复制 Skill 正文",
        "Context Builder / Provider / Tool / Policy / Verifier 不得伪装成 Skill",
        "深度研究必须选择一个 primary_lens 和一个 counter_lens；二者均来自 research_lenses.yaml",
        "expression preset 只控制交付形态，不得降低证据、判断或风险披露要求"
      ],
      "schema_name": "capability_skills_registry",
      "schema_version": "3.0.0",
      "skills": [
        {
          "execution_contract": {
            "allowed_tools": [],
            "eligible_agents": [
              "research-lead"
            ],
            "output_kind": "research_plan",
            "procedure": [
              "识别会改变路径的缺口",
              "给出可编辑默认值",
              "把目标表达为可证伪问题"
            ]
          },
          "package": "03_agent_capability/02_skills/research_framing",
          "purpose": "明确对象、期限、决策、成功标准与必要澄清",
          "skill_id": "research-framing",
          "skill_md": "03_agent_capability/02_skills/research_framing/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [],
            "eligible_agents": [
              "research-lead",
              "analysis-specialist"
            ],
            "output_kind": "method_application",
            "procedure": [
              "识别判断类型",
              "匹配方法约束",
              "记录替代方法与退出条件"
            ]
          },
          "package": "03_agent_capability/02_skills/research_design",
          "purpose": "面对 Task 选择研究框架、判断结构与证伪设计",
          "replaces": "research-design",
          "resources": [
            "03_agent_capability/02_skills/research_design/references",
            "03_agent_capability/02_skills/research_design/registry.yaml",
            "03_agent_capability/02_skills/research_design/research_lenses.yaml"
          ],
          "skill_id": "research-design",
          "skill_md": "03_agent_capability/02_skills/research_design/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "source.discover",
              "source.capture",
              "source.query"
            ],
            "eligible_agents": [
              "research-lead",
              "evidence-investigator",
              "independent-critic"
            ],
            "output_kind": "evidence_package",
            "procedure": [
              "区分候选来源、快照和 EvidenceFact",
              "检查交叉验证",
              "证据不足时显式停止"
            ]
          },
          "package": "03_agent_capability/02_skills/evidence_research",
          "purpose": "证据需求、来源选择、获取核验、留痕、完备度与反证",
          "replaces": "evidence-research",
          "resources": [
            "03_agent_capability/02_skills/evidence_research/references",
            "03_agent_capability/02_skills/evidence_research/templates",
            "03_agent_capability/02_skills/evidence_research/registry.yaml",
            "03_agent_capability/02_skills/evidence_research/references/source_routes.yaml"
          ],
          "skill_id": "evidence-research",
          "skill_md": "03_agent_capability/02_skills/evidence_research/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "source.query"
            ],
            "eligible_agents": [
              "research-lead",
              "analysis-specialist"
            ],
            "output_kind": "hypothesis_map",
            "procedure": [
              "列出竞争解释",
              "绑定支持与反证",
              "定义区分性观察和改判信号"
            ]
          },
          "package": "03_agent_capability/02_skills/judgment_reasoning",
          "purpose": "主假设、竞争解释、因果链、反证、情景与判断强度",
          "replaces": "judgment-reasoning",
          "resources": [
            "03_agent_capability/02_skills/judgment_reasoning/references"
          ],
          "skill_id": "judgment-reasoning",
          "skill_md": "03_agent_capability/02_skills/judgment_reasoning/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "artifact.publish"
            ],
            "eligible_agents": [
              "research-lead"
            ],
            "output_kind": "report",
            "procedure": [
              "只使用正式制品",
              "区分事实、推断与观点",
              "保留不确定性和改判条件"
            ]
          },
          "package": "03_agent_capability/02_skills/research_delivery",
          "purpose": "将已验证证据与判断组织为快答、研报、判断卡等交付物",
          "replaces": "research-delivery",
          "resources": [
            "03_agent_capability/02_skills/research_delivery/references",
            "03_agent_capability/02_skills/research_delivery/templates",
            "03_agent_capability/02_skills/research_delivery/expression_presets.yaml"
          ],
          "skill_id": "research-delivery",
          "skill_md": "03_agent_capability/02_skills/research_delivery/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "source.query"
            ],
            "eligible_agents": [
              "research-lead"
            ],
            "output_kind": "hypothesis_map",
            "procedure": [
              "冻结公司和报告期边界",
              "绑定经营到财务传导",
              "列出竞争解释"
            ]
          },
          "package": "03_agent_capability/02_skills/company_fundamental_research",
          "purpose": "将商业模式、关键 KPI、竞争优势与财务传导组织为可证伪的公司研究输入",
          "resources": [
            "03_agent_capability/02_skills/company_fundamental_research/references"
          ],
          "skill_id": "company-fundamental-research",
          "skill_md": "03_agent_capability/02_skills/company_fundamental_research/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "source.query"
            ],
            "eligible_agents": [
              "research-lead"
            ],
            "output_kind": "hypothesis_map",
            "procedure": [
              "冻结产品和区域口径",
              "区分直接指标与代理指标",
              "说明公司暴露与时滞"
            ]
          },
          "package": "03_agent_capability/02_skills/sector_cycle_research",
          "purpose": "分析供需、库存、价格、产能、产业链和周期位置，并映射至公司",
          "resources": [
            "03_agent_capability/02_skills/sector_cycle_research/references"
          ],
          "skill_id": "sector-cycle-research",
          "skill_md": "03_agent_capability/02_skills/sector_cycle_research/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "source.query",
              "financial.model.validate"
            ],
            "eligible_agents": [
              "research-lead",
              "financial-modeler"
            ],
            "output_kind": "financial_model",
            "procedure": [
              "历史与预测边界分离",
              "冻结单位、币种和口径",
              "模型审计失败即阻断估值"
            ]
          },
          "package": "03_agent_capability/02_skills/financial_modeling",
          "purpose": "标准化历史财务、驱动式预测、三表勾稽、情景和敏感性",
          "resources": [
            "03_agent_capability/02_skills/financial_modeling/references",
            "03_agent_capability/contracts/financial_model_artifact_contract.yaml"
          ],
          "skill_id": "financial-modeling",
          "skill_md": "03_agent_capability/02_skills/financial_modeling/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "source.query",
              "financial.model.validate"
            ],
            "eligible_agents": [
              "research-lead",
              "financial-modeler"
            ],
            "output_kind": "valuation_analysis",
            "procedure": [
              "冻结 asOf 与股本口径",
              "说明方法适用性",
              "不生成评级或目标价"
            ]
          },
          "package": "03_agent_capability/02_skills/valuation_analysis",
          "purpose": "在已审计模型基础上进行可比估值、DCF/SOTP 和敏感性分析",
          "resources": [
            "03_agent_capability/02_skills/valuation_analysis/references"
          ],
          "skill_id": "valuation-analysis",
          "skill_md": "03_agent_capability/02_skills/valuation_analysis/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "source.query",
              "financial.model.validate"
            ],
            "eligible_agents": [
              "research-lead"
            ],
            "output_kind": "thesis_state",
            "procedure": [
              "无 vintage 一致预期即阻断 beat/miss",
              "分解一次性项目",
              "记录模型修订"
            ]
          },
          "package": "03_agent_capability/02_skills/earnings_update",
          "purpose": "解释实际值、公司指引、内部前值和授权一致预期的差异，并更新模型与命题影响",
          "resources": [
            "03_agent_capability/02_skills/earnings_update/references"
          ],
          "skill_id": "earnings-update",
          "skill_md": "03_agent_capability/02_skills/earnings_update/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search"
            ],
            "eligible_agents": [
              "research-lead"
            ],
            "output_kind": "thesis_state",
            "procedure": [
              "不得覆盖历史版本",
              "信号必须绑定制品引用",
              "不替代正式改判"
            ]
          },
          "package": "03_agent_capability/02_skills/thesis_monitoring",
          "purpose": "版本化记录命题支柱、强化/削弱/阻断信号、催化剂和失效条件",
          "resources": [
            "03_agent_capability/02_skills/thesis_monitoring/references"
          ],
          "skill_id": "thesis-monitoring",
          "skill_md": "03_agent_capability/02_skills/thesis_monitoring/SKILL.md"
        },
        {
          "execution_contract": {
            "allowed_tools": [
              "semantic.search",
              "financial.model.validate"
            ],
            "eligible_agents": [
              "independent-critic"
            ],
            "output_kind": "review",
            "procedure": [
              "只读取授权制品切片",
              "只输出 review",
              "不得静默改写主制品"
            ]
          },
          "package": "03_agent_capability/02_skills/independent_research_review",
          "purpose": "在隔离上下文审查证据越权、模型错误、遗漏反证与叙事偏见，只输出 review",
          "resources": [
            "03_agent_capability/02_skills/independent_research_review/references"
          ],
          "skill_id": "independent-research-review",
          "skill_md": "03_agent_capability/02_skills/independent_research_review/SKILL.md"
        }
      ],
      "status": "active"
    },
    "tools": {
      "definition_authority": "03_agent_capability/03_tools",
      "execution_binding": "06_runtime/src/capabilities/registry.ts",
      "rules": [
        "有副作用动作必须提供 idempotency_key",
        "Tool 表达动作语义，不表达底层传输协议",
        "MCP 是 Tool 的连接协议，不是来源生产者"
      ],
      "schema_name": "capability_tools_registry",
      "schema_version": "3.0.0",
      "status": "active",
      "tools": [
        {
          "description": "混合检索本体、全文、词典与图引用",
          "idempotent": true,
          "risk": "read",
          "tool_id": "semantic.search",
          "version": "1.0.0"
        },
        {
          "description": "发现候选研究来源",
          "idempotent": true,
          "risk": "read",
          "tool_id": "source.discover",
          "version": "1.0.0"
        },
        {
          "description": "抓取并冻结指定来源快照",
          "idempotent": true,
          "risk": "write",
          "tool_id": "source.capture",
          "version": "1.0.0"
        },
        {
          "description": "按来源策略查询外部材料",
          "idempotent": true,
          "notes": "动作语义是查询/检索来源材料；底层可通过 MCP / API / DB 适配，不把协议名暴露为 Tool 名",
          "protocol_registry": "03_agent_capability/04_protocols/mcp/registry.yaml",
          "replaces": "source.query",
          "risk": "read",
          "tool_id": "source.query",
          "version": "1.0.0"
        },
        {
          "approval_required": true,
          "description": "在研究员批准后发布正式制品",
          "idempotent": true,
          "risk": "external_side_effect",
          "tool_id": "artifact.publish",
          "version": "1.0.0"
        },
        {
          "approval_required": false,
          "description": "确定性校验模型边界、公式依赖、审计和一致预期条件",
          "idempotent": true,
          "risk": "read",
          "tool_id": "financial.model.validate",
          "version": "1.0.0"
        }
      ]
    }
  },
  "companyFundamentalSemantics": {
    "financial_bridge": {
      "balance_sheet": [
        "inventory",
        "contract_liability",
        "receivables",
        "fixed_assets",
        "debt",
        "cash"
      ],
      "cash_flow": [
        "operating_cash_flow",
        "capital_expenditure",
        "free_cash_flow"
      ],
      "income_statement": [
        "revenue",
        "gross_profit",
        "operating_profit",
        "net_profit"
      ],
      "operating_inputs": [
        "volume",
        "price",
        "product_mix",
        "utilization",
        "yield",
        "order_backlog",
        "delivery",
        "customer_qualification"
      ],
      "required_edge_metadata": [
        "period",
        "direction",
        "evidence_ref",
        "assumption_status"
      ]
    },
    "identity_contract": {
      "invariants": [
        "公司主体、证券和报告主体必须显式关联，不得仅凭简称合并。",
        "证券价格或估值观测必须指向 FinancialInstrument，公司经营事实必须指向 Company。"
      ],
      "optional_identifiers": [
        "exchange",
        "unified_social_credit_code"
      ],
      "reporting_subject": "Company",
      "required_identifiers": [
        "company_code",
        "company_name"
      ],
      "research_subject": "Company",
      "security_subject": "FinancialInstrument"
    },
    "measurement_context": {
      "accounting_basis": [
        "reported",
        "restated",
        "adjusted"
      ],
      "comparison_rules": {
        "analyst_forecast": "必须引用冻结假设或明确标记 analyst_assumption。",
        "authorized_consensus": "必须保留 provider、permission_scope、as_of 与 vintage。",
        "company_guidance": "必须保留披露来源、区间和适用期间。",
        "historical_actual": "可与相同主体、指标、期间、单位和会计口径的历史值比较。",
        "internal_prior": "必须保留形成时间与版本。",
        "scenario_assumption": "只能用于情景，不得伪装为预测事实。"
      },
      "required": [
        "as_of",
        "period",
        "currency",
        "unit",
        "accounting_basis",
        "value_origin"
      ],
      "runtime_financial_basis_projection": {
        "semantic_mapping": {
          "consensus": "authorized_consensus",
          "forecast": "analyst_forecast",
          "guidance": "company_guidance"
        },
        "values": [
          "reported",
          "restated",
          "adjusted",
          "guidance",
          "internal_prior",
          "consensus",
          "forecast"
        ]
      },
      "value_origin": [
        "historical_actual",
        "internal_prior",
        "company_guidance",
        "authorized_consensus",
        "analyst_forecast",
        "scenario_assumption"
      ]
    },
    "schema_name": "company_fundamental_semantics",
    "schema_version": "1.0.0",
    "scope": "A 股半导体公司基本面研究",
    "semantic_boundaries": [
      "行业景气证据不能直接证明公司兑现，必须通过公司暴露和经营传导。",
      "管理层表述属于来源材料，只有可定位并核验后才能成为 EvidenceFact。",
      "估值输入必须来自审计通过的 financial_model 或显式受限的敏感性假设。",
      "本合同不授权评级、目标价、仓位或交易指令。"
    ],
    "status": "active"
  },
  "contextState": {
    "context": {
      "assembly_inputs": [
        {
          "contributes": [
            "task_definition",
            "workflow_pattern",
            "role"
          ],
          "domain": "scenario_task",
          "path": "02_scenario_task"
        },
        {
          "contributes": [
            "agent",
            "skill",
            "tool",
            "protocol"
          ],
          "domain": "agent_capability",
          "path": "03_agent_capability"
        },
        {
          "contributes": [
            "session_state",
            "task_state",
            "run_state"
          ],
          "domain": "context_state",
          "path": "04_context_state/02_state"
        },
        {
          "contributes": [
            "workspace_refs",
            "artifact_refs"
          ],
          "domain": "context_state",
          "path": "04_context_state/04_workspace"
        },
        {
          "contributes": [
            "memory_refs"
          ],
          "domain": "context_state",
          "path": "04_context_state/03_memory"
        },
        {
          "contributes": [
            "ontology_refs",
            "dictionary_refs",
            "graph_refs"
          ],
          "domain": "semantic_knowledge",
          "path": "01_semantic_knowledge"
        },
        {
          "contributes": [
            "policy_refs",
            "permission_refs",
            "verifier_refs"
          ],
          "domain": "control_evaluation",
          "path": "05_control_evaluation"
        }
      ],
      "authority": {
        "answers": "单次 Agent 调用前，模型被允许看见什么",
        "implementation": "06_runtime/src/runtime/kernel.ts",
        "read_primary": "04_context_state/01_context/contract.yaml",
        "type_binding": "06_runtime/src/contracts.ts#ContextPackage",
        "write_entry": "04_context_state/01_context/"
      },
      "context_package": {
        "metadata": [
          "source_ref",
          "asset_version",
          "selection_reason",
          "freshness_at",
          "token_budget",
          "trimmed_reason",
          "permission_filter_result"
        ],
        "required_sections": [
          "identity",
          "task",
          "state",
          "workspace",
          "memory",
          "knowledge",
          "capabilities",
          "policies"
        ]
      },
      "current_runtime_coverage": {
        "implemented": [
          "identity / task / state / workspace / memory / knowledge / capabilities / policies 全部必备分段",
          "knowledge release / lock 引用",
          "reference reason / version / freshness",
          "token_budget",
          "trimmed_reason（发生裁剪时）与 permission_filter_result",
          "Event Manifest 留痕"
        ],
        "intentionally_transient": [
          "ContextPackage 只以 append-only Event Manifest 留痕，不建可编辑实体表"
        ]
      },
      "definition": "Context 是 Runtime 在某一时刻，把任务相关信息裁剪、组装成的临时视图。\n它不保存长期知识，也不替代 State / Memory / Workspace / Knowledge 的权威。\n",
      "implementation_status": "runtime_reference_manifest",
      "invariants": [
        "ContextPackage 不作为长期知识库或独立业务实体仓库",
        "每次装配必须记录引用、版本、选择理由、预算与新鲜度",
        "权限过滤后不可见的内容不得进入 Context",
        "Memory / Knowledge / Method / Eval 正文不得整包灌入；只注入本次需要的引用与摘要",
        "Context 缺失时不得伪造历史偏好、正式结论或未授权材料"
      ],
      "lifecycle": [
        "assemble",
        "consume",
        "record",
        "discard"
      ],
      "notes": [
        "类型实现绑定见 06_runtime/src/contracts.ts#ContextPackage；合同变更后 Runtime 必须对齐。",
        "上下文装配与运行边界以 06_runtime/ARCHITECTURE.md 和 Runtime Context Builder 为准。"
      ],
      "schema_name": "context_contract",
      "schema_version": "1.0.0",
      "status": "active"
    },
    "events": {
      "append_only": true,
      "event_families": {
        "approval": [
          "approval.requested",
          "approval.approved",
          "approval.rejected",
          "approval.superseded"
        ],
        "artifact": [
          "artifact.created",
          "artifact.verified",
          "artifact.edited",
          "artifact.superseded",
          "artifact.recompute_queued"
        ],
        "checkpoint": [
          "checkpoint.current",
          "checkpoint.superseded"
        ],
        "job": [
          "job.queued",
          "job.started",
          "job.completed",
          "job.failed",
          "job.cancelled"
        ],
        "material": [
          "material.attached",
          "source.captured",
          "evidence.promoted"
        ],
        "node": [
          "node.ready",
          "node.started",
          "node.completed",
          "node.blocked",
          "node.failed",
          "node.invalidated",
          "node.cancelled"
        ],
        "research_case": [
          "research_case.created",
          "research_case.activated",
          "research_case.completed",
          "research_case.cancelled"
        ],
        "signal": [
          "signal.seen",
          "signal.dismissed",
          "signal.promoted"
        ],
        "task": [
          "plan.confirmed",
          "task.queued",
          "task.started",
          "task.paused",
          "task.input_requested",
          "task.completed",
          "task.failed",
          "task.cancelled"
        ]
      },
      "optional_identity": [
        "conversationId",
        "researchCaseId",
        "taskId",
        "nodeId",
        "artifactId",
        "approvalId"
      ],
      "required_envelope": [
        "id",
        "type",
        "actorType",
        "actorId",
        "createdAt",
        "payload"
      ],
      "schema_name": "runtime_event_catalog",
      "schema_version": "1.0.0",
      "status": "active",
      "unknown_event_behavior": "reject"
    },
    "lifecycle": {
      "approval_command_mapping": {
        "evidence_confirmation": {
          "command": "confirm_evidence",
          "label": "确认这组证据"
        },
        "judgment_confirmation": {
          "command": "approve_judgment",
          "label": "批准判断"
        },
        "plan_confirmation": {
          "command": "confirm_plan",
          "label": "确认计划并开始"
        },
        "publish_confirmation": {
          "command": "publish",
          "label": "确认发布"
        }
      },
      "authority": {
        "answers": "运行聚合的状态、命令、转换、结果、事件、幂等与恢复边界",
        "executor": "06_runtime/src/runtime/state-machine.ts",
        "runtime_projection": "06_runtime/src/generated/domain-catalog.ts",
        "write_entry": "04_context_state/02_state/"
      },
      "command_contract": {
        "commands": [
          "confirm_plan",
          "attach_material",
          "confirm_evidence",
          "revise_judgment",
          "approve_judgment",
          "revise_report",
          "publish",
          "retry",
          "cancel"
        ],
        "duplicate_idempotency_key": {
          "behavior": "return_original_result",
          "creates_event": false
        },
        "invalid_transition": {
          "error_code": "invalid_state_transition",
          "http_status": 409
        },
        "required_fields": [
          "type",
          "expectedVersion",
          "idempotencyKey",
          "payload"
        ]
      },
      "invariants": [
        "终态必须有 task_outcome，非终态不得伪装为完成结果。",
        "每次状态变化必须在同一事务中追加声明的 Event。",
        "Checkpoint 只负责恢复，不替代 Event 或当前 State。",
        "Artifact 修订产生新版本并使旧版本 superseded，禁止原地覆盖。",
        "Approval 绑定具体 Artifact 版本，版本变化后旧 Approval 必须 superseded。"
      ],
      "outcome_rules": {
        "blocked_missing_source": {
          "when": "required_source_unavailable_without_permission_denial"
        },
        "blocked_permission": {
          "when": "required_source_or_action_denied_by_permission"
        },
        "blocked_policy": {
          "when": "governance_policy_prevents_required_action"
        },
        "cancelled_by_user": {
          "when": "user_cancel_command"
        },
        "completed_indeterminate": {
          "when": "required_units_explicit_indeterminate_and_no_open_required_frontier"
        },
        "completed_supported": {
          "when": "approved_or_published_judgment_exists"
        },
        "failed_technical": {
          "when": "unrecoverable_runtime_failure"
        },
        "stopped_insufficient_evidence": {
          "when": "evidence_requirement_unfulfilled_or_abstain_judgment"
        }
      },
      "schema_name": "runtime_lifecycle_contract",
      "schema_version": "2.0.0",
      "state_machines": {
        "Approval": {
          "initial": "pending",
          "states": [
            "pending",
            "approved",
            "rejected",
            "superseded"
          ],
          "terminal": [
            "approved",
            "rejected",
            "superseded"
          ],
          "transitions": [
            {
              "command": "approve",
              "event": "approval.approved",
              "from": "pending",
              "to": "approved"
            },
            {
              "command": "reject",
              "event": "approval.rejected",
              "from": "pending",
              "to": "rejected"
            },
            {
              "command": "artifact_revised",
              "event": "approval.superseded",
              "from": "pending",
              "to": "superseded"
            }
          ]
        },
        "Artifact": {
          "initial": "draft",
          "states": [
            "draft",
            "verified",
            "superseded"
          ],
          "terminal": [
            "superseded"
          ],
          "transitions": [
            {
              "command": "verify",
              "event": "artifact.verified",
              "from": "draft",
              "to": "verified"
            },
            {
              "command": "revise",
              "event": "artifact.superseded",
              "from": [
                "draft",
                "verified"
              ],
              "to": "superseded"
            },
            {
              "command": "revise_judgment",
              "event": "artifact.superseded",
              "from": [
                "draft",
                "verified"
              ],
              "to": "superseded"
            },
            {
              "command": "revise_report",
              "event": "artifact.superseded",
              "from": [
                "draft",
                "verified"
              ],
              "to": "superseded"
            }
          ]
        },
        "Checkpoint": {
          "initial": "created",
          "states": [
            "created",
            "current",
            "superseded"
          ],
          "terminal": [
            "superseded"
          ],
          "transitions": [
            {
              "command": "activate",
              "event": "checkpoint.current",
              "from": "created",
              "to": "current"
            },
            {
              "command": "replace",
              "event": "checkpoint.superseded",
              "from": "current",
              "to": "superseded"
            }
          ]
        },
        "KnowledgeCandidate": {
          "initial": "observed",
          "states": [
            "observed",
            "normalized",
            "proposed",
            "evaluating",
            "review_required",
            "approved",
            "released",
            "rejected",
            "superseded",
            "monitor"
          ],
          "terminal": [
            "released",
            "rejected",
            "superseded"
          ],
          "transition_authority": "05_control_evaluation/01_rules/knowledge_promotion/knowledge_learning_contract.yaml"
        },
        "ResearchCase": {
          "initial": "draft",
          "states": [
            "draft",
            "active",
            "waiting_input",
            "completed",
            "cancelled"
          ],
          "terminal": [
            "completed",
            "cancelled"
          ],
          "transitions": [
            {
              "command": "confirm_plan",
              "event": "research_case.activated",
              "from": "draft",
              "to": "active"
            },
            {
              "command": "attach_material",
              "event": "material.attached",
              "from": [
                "active",
                "waiting_input"
              ],
              "to": "active"
            },
            {
              "command": "confirm_evidence",
              "event": "evidence.confirmed",
              "from": [
                "active",
                "waiting_input"
              ],
              "to": "active"
            },
            {
              "command": "revise_judgment",
              "event": "judgment.revised",
              "from": "active",
              "to": "active"
            },
            {
              "command": "approve_judgment",
              "event": "judgment.approved",
              "from": "active",
              "to": "active"
            },
            {
              "command": "revise_report",
              "event": "report.revised",
              "from": "active",
              "to": "active"
            },
            {
              "command": "retry",
              "event": "research_case.retried",
              "from": "waiting_input",
              "to": "active"
            },
            {
              "command": "publish",
              "event": "research_case.completed",
              "from": "active",
              "to": "completed"
            },
            {
              "command": "cancel",
              "event": "research_case.cancelled",
              "from": [
                "draft",
                "active",
                "waiting_input"
              ],
              "to": "cancelled"
            }
          ]
        },
        "ResearchSignal": {
          "initial": "new",
          "kinds": [
            "news",
            "announcement"
          ],
          "states": [
            "new",
            "seen",
            "dismissed",
            "promoted"
          ],
          "terminal": [
            "dismissed",
            "promoted"
          ],
          "transitions": [
            {
              "command": "mark_seen",
              "event": "signal.seen",
              "from": "new",
              "to": "seen"
            },
            {
              "command": "dismiss",
              "event": "signal.dismissed",
              "from": [
                "new",
                "seen"
              ],
              "to": "dismissed"
            },
            {
              "command": "promote",
              "event": "signal.promoted",
              "from": [
                "new",
                "seen"
              ],
              "to": "promoted"
            }
          ]
        },
        "RuntimeJob": {
          "initial": "queued",
          "states": [
            "queued",
            "running",
            "completed",
            "failed",
            "cancelled"
          ],
          "terminal": [
            "completed",
            "cancelled"
          ],
          "transitions": [
            {
              "command": "lease",
              "event": "job.started",
              "from": "queued",
              "to": "running"
            },
            {
              "command": "runtime_complete",
              "event": "job.completed",
              "from": "running",
              "to": "completed"
            },
            {
              "command": "runtime_fail",
              "event": "job.failed",
              "from": "running",
              "to": "failed"
            },
            {
              "command": "retry",
              "event": "job.queued",
              "from": "failed",
              "to": "queued"
            },
            {
              "command": "cancel",
              "event": "job.cancelled",
              "from": [
                "queued",
                "running",
                "failed"
              ],
              "to": "cancelled"
            }
          ]
        },
        "Task": {
          "initial": "planned",
          "states": [
            "planned",
            "queued",
            "running",
            "paused",
            "waiting_input",
            "waiting_approval",
            "waiting_handoff",
            "completed",
            "failed",
            "cancelled"
          ],
          "terminal": [
            "completed",
            "failed",
            "cancelled"
          ],
          "transitions": [
            {
              "command": "confirm_plan",
              "event": "plan.confirmed",
              "from": "planned",
              "to": "queued"
            },
            {
              "command": "request_input",
              "event": "task.input_requested",
              "from": "planned",
              "to": "waiting_input"
            },
            {
              "command": "request_approval",
              "event": "approval.requested",
              "from": "planned",
              "to": "waiting_approval"
            },
            {
              "command": "runtime_start",
              "event": "task.started",
              "from": "queued",
              "to": "running"
            },
            {
              "command": "request_input",
              "event": "task.input_requested",
              "from": "running",
              "to": "waiting_input"
            },
            {
              "command": "request_approval",
              "event": "approval.requested",
              "from": [
                "queued",
                "running",
                "completed"
              ],
              "to": "waiting_approval"
            },
            {
              "command": "confirm_plan",
              "event": "plan.confirmed",
              "from": "waiting_approval",
              "to": "queued"
            },
            {
              "command": "approve",
              "event": "task.queued",
              "from": "waiting_approval",
              "to": "queued"
            },
            {
              "command": "reject",
              "event": "task.input_requested",
              "from": "waiting_approval",
              "to": "waiting_input"
            },
            {
              "command": "pause",
              "event": "task.paused",
              "from": [
                "queued",
                "running"
              ],
              "to": "paused"
            },
            {
              "command": "retry",
              "event": "task.queued",
              "from": [
                "waiting_input",
                "waiting_approval",
                "paused",
                "failed"
              ],
              "to": "queued"
            },
            {
              "command": "invalidate",
              "event": "task.queued",
              "from": [
                "waiting_input",
                "waiting_approval",
                "completed",
                "failed"
              ],
              "to": "queued"
            },
            {
              "command": "cancel",
              "event": "task.cancelled",
              "from": [
                "planned",
                "queued",
                "running",
                "paused",
                "waiting_input",
                "waiting_approval",
                "waiting_handoff"
              ],
              "to": "cancelled"
            },
            {
              "command": "runtime_complete",
              "event": "task.completed",
              "from": "running",
              "to": "completed"
            },
            {
              "command": "runtime_fail",
              "event": "task.failed",
              "from": [
                "queued",
                "running"
              ],
              "to": "failed"
            }
          ]
        },
        "TaskNode": {
          "initial": "pending",
          "states": [
            "pending",
            "ready",
            "running",
            "blocked",
            "completed",
            "failed",
            "cancelled"
          ],
          "terminal": [
            "completed",
            "cancelled"
          ],
          "transitions": [
            {
              "command": "dependencies_ready",
              "event": "node.ready",
              "from": "pending",
              "to": "ready"
            },
            {
              "command": "runtime_start",
              "event": "node.started",
              "from": "ready",
              "to": "running"
            },
            {
              "command": "runtime_complete",
              "event": "node.completed",
              "from": "running",
              "to": "completed"
            },
            {
              "command": "policy_block",
              "event": "node.blocked",
              "from": [
                "pending",
                "ready",
                "running"
              ],
              "to": "blocked"
            },
            {
              "command": "dependency_block",
              "event": "node.blocked",
              "from": [
                "pending",
                "ready",
                "failed"
              ],
              "to": "blocked"
            },
            {
              "command": "runtime_fail",
              "event": "node.failed",
              "from": "running",
              "to": "failed"
            },
            {
              "command": "retry",
              "event": "node.ready",
              "from": [
                "blocked",
                "failed"
              ],
              "to": "ready"
            },
            {
              "command": "invalidate",
              "event": "node.invalidated",
              "from": [
                "ready",
                "blocked",
                "completed",
                "failed"
              ],
              "to": "pending"
            },
            {
              "command": "cancel",
              "event": "node.cancelled",
              "from": [
                "pending",
                "ready",
                "running",
                "blocked",
                "failed"
              ],
              "to": "cancelled"
            }
          ]
        }
      },
      "status": "active",
      "task_outcome_labels": {
        "blocked_missing_source": "缺少必需来源",
        "blocked_permission": "来源或操作权限受阻",
        "blocked_policy": "治理政策阻断",
        "cancelled_by_user": "研究员已结束本轮",
        "completed_indeterminate": "已完成（暂不可判断）",
        "completed_supported": "已完成（有证据支持）",
        "failed_technical": "技术执行失败",
        "stopped_insufficient_evidence": "证据不足，已克制停止"
      },
      "task_outcomes": [
        "completed_supported",
        "completed_indeterminate",
        "stopped_insufficient_evidence",
        "blocked_permission",
        "blocked_missing_source",
        "blocked_policy",
        "failed_technical",
        "cancelled_by_user"
      ]
    },
    "memory": {
      "authority": {
        "answers": "跨任务可保留什么 / 不可把什么当长期真理",
        "implementation": "06_runtime/src/runtime/store.ts#memory_records",
        "read_primary": "04_context_state/03_memory/contract.yaml",
        "write_entry": "04_context_state/03_memory/"
      },
      "current_runtime_coverage": {
        "implemented": [
          "preference / topic_index / validated_failure_pattern kind 约束",
          "content / provenanceArtifactIds / source_ref / freshnessAt / reviewedAt 独立存储",
          "Context 装配只注入 Memory 引用、来源与新鲜度",
          "正式知识候选经 mining → evaluation → approval → Release，不由 Memory 静默晋级"
        ]
      },
      "definition": "Memory 是为未来调用优化体验的选择性记忆。\n它不是正式知识、方法或评测权威；正式真理仍在 01 / 03 / 05。\n",
      "implementation_status": "governed_storage",
      "may_persist": [
        "user_preferences",
        "researched_theme_history",
        "validated_failure_modes"
      ],
      "must_not_persist_as_truth": [
        "single_run_judgments",
        "unverified_evidence_drafts",
        "secrets_or_credentials",
        "raw_model_chain_of_thought",
        "unauthorized_or_non_public_materials",
        "full_copies_of_eval_or_ontology_rules"
      ],
      "notes": [
        "SQLite 已实现 MemoryRecord；只有偏好、主题索引和经治理验证的失败模式可写入。",
        "与 Workspace（本次产物）严格分离；与 Knowledge / Eval（正式权威）严格分离。"
      ],
      "read_rules": [
        "Context 装配可读取 Memory，但必须标注 memory_ref 与新鲜度",
        "Memory 缺失时不得伪造历史偏好或历史结论",
        "读取 validated_failure_modes 时应能回溯到 Eval / governance source_ref"
      ],
      "schema_name": "memory_contract",
      "schema_version": "3.0.0",
      "scopes": [
        {
          "description": "研究员偏好（默认交付原型、展示语言、确认习惯）",
          "id": "user_preferences",
          "promotion_required": false,
          "retention": "until_user_reset"
        },
        {
          "description": "曾研究过的主题/对象索引（不含单次结论正文）",
          "id": "researched_theme_history",
          "promotion_required": false,
          "retention": "rolling_12_months"
        },
        {
          "authority_note": "Memory 只存 summary + source_ref（如 eval://failure_mode/FM-018）+ freshness；\n完整规则权威仍在 05_control_evaluation。\n",
          "description": "已验证失败模式的可调用摘要与引用（不复制完整规则正文）",
          "id": "validated_failure_modes",
          "promotion_path": "05_control_evaluation/05_evals or knowledge candidate queue",
          "promotion_required": true,
          "retention": "until_superseded"
        }
      ],
      "status": "active",
      "write_rules": [
        "Memory 写入不得绕过 Workspace 追溯（须能指出来源 run_id / artifact）",
        "单次 Judgment / ReportClaim 不得直接写成长期 Memory 真理",
        "候选知识贡献须走元治理/候选队列，不得静默写回正式本体或 methods",
        "validated_failure_modes 只写引用与摘要，不夺 05 的权威"
      ]
    },
    "state": {
      "authority": {
        "answers": "这个任务现在进行到哪里",
        "event_catalog": "04_context_state/02_state/event_catalog.yaml",
        "implementation": "06_runtime/src/runtime/store.ts",
        "lifecycle_contract": "04_context_state/02_state/lifecycle_contract.yaml",
        "read_primary": "04_context_state/02_state/contract.yaml",
        "related": {
          "checkpoints": "06_runtime/src/runtime/store.ts",
          "events": "06_runtime/src/runtime/store.ts"
        },
        "write_entry": "04_context_state/02_state/"
      },
      "boundaries": {
        "not_state": [
          "task_type_definition",
          "method_or_skill_body",
          "full_event_log",
          "checkpoint_blob_storage",
          "historical_sample_packages"
        ]
      },
      "current_runtime_projection": {
        "implemented": [
          "TaskStatus / NodeStatus 值域由本合同生成到 Runtime",
          "pause / resume 与 Checkpoint 恢复引用",
          "waiting_handoff 会阻止调度，直到交接状态被解除",
          "ContextPackage 投影 pending action / approval / latest event / checkpoint"
        ],
        "intentionally_projected": [
          "SessionState / TaskState / RunState 可由现行权威表确定性读取，不复制一组可漂移的独立状态表"
        ],
        "run_state": {
          "coverage": "projected",
          "sources": [
            "RuntimeJob",
            "TaskNode",
            "latest Event",
            "latest Checkpoint"
          ]
        },
        "session_state": {
          "coverage": "projected",
          "sources": [
            "Conversation",
            "active Task"
          ]
        },
        "task_state": {
          "coverage": "projected",
          "sources": [
            "Task",
            "TaskNode",
            "Approval",
            "latest Event",
            "latest Checkpoint"
          ]
        }
      },
      "definition": "State 描述运行实例的当前状态，不是 Task 定义，也不是聊天记录推断。\nEvent 记录发生过什么；State 描述现在是什么；Checkpoint 是 Runtime 恢复手段。\n",
      "implementation_status": "runtime_projection",
      "invariants": [
        "State 必须可由 Checkpoint + 必要投影恢复，但不能用纯聊天记录替代 State",
        "pending_approval / handoff_ref 存在时，status 必须反映等待态",
        "current_plan / active_step 变更应伴随 Event；State 只保留当前值",
        "本域定义合同；物化与迁移由 06_runtime 负责"
      ],
      "layers": {
        "run": {
          "fields": [
            "run_id",
            "task_instance_id",
            "status",
            "active_node_id",
            "last_event",
            "checkpoint_ref",
            "updated_at"
          ],
          "id": "RunState"
        },
        "session": {
          "fields": [
            "session_id",
            "conversation_id",
            "status",
            "active_task_instance_id",
            "updated_at"
          ],
          "id": "SessionState"
        },
        "task": {
          "fields": [
            "task_instance_id",
            "session_id",
            "status",
            "current_goal",
            "current_plan",
            "active_step",
            "pending_action",
            "pending_approval",
            "handoff_ref",
            "last_event",
            "checkpoint_ref",
            "updated_at"
          ],
          "id": "TaskState"
        }
      },
      "mvp_fields": [
        "session_id",
        "task_instance_id",
        "run_id",
        "status",
        "current_goal",
        "current_plan",
        "active_step",
        "pending_action",
        "pending_approval",
        "handoff_ref",
        "last_event",
        "checkpoint_ref",
        "updated_at"
      ],
      "notes": [
        "MVP 可先以 Task/Run 投影 + latest Checkpoint 满足合同；后续可显式物化 State 表。",
        "示例问题：「中微公司研究现在做到哪里了？」应直接读 State，而不是重扫对话。"
      ],
      "runtime_status_projection": {
        "authority_rule": "06 Runtime 类型必须由本列表生成或通过防漂移校验，不得维护第二套状态值域。",
        "node_status_values": [
          "pending",
          "ready",
          "running",
          "blocked",
          "completed",
          "failed",
          "cancelled"
        ],
        "task_status_values": [
          "planned",
          "queued",
          "running",
          "paused",
          "waiting_input",
          "waiting_approval",
          "waiting_handoff",
          "completed",
          "failed",
          "cancelled"
        ]
      },
      "schema_name": "runtime_state_contract",
      "schema_version": "2.0.0",
      "status": "active",
      "status_values": [
        "pending",
        "running",
        "paused",
        "waiting_approval",
        "waiting_handoff",
        "completed",
        "failed",
        "cancelled"
      ],
      "supports": [
        "pause",
        "resume",
        "replan",
        "handoff",
        "fail_recovery"
      ],
      "task_outcome_authority": "04_context_state/02_state/lifecycle_contract.yaml#task_outcomes"
    },
    "workspace": {
      "artifact_contract": {
        "authority_rule": "Artifact 类型与状态属于 Workspace/State 合同；06 只能消费生成投影，不得另写值域。",
        "kinds": [
          "research_plan",
          "research_problem_graph",
          "method_application",
          "evidence_package",
          "hypothesis_map",
          "judgment",
          "report",
          "review",
          "normalized_financials",
          "financial_model",
          "valuation_analysis",
          "thesis_state",
          "ui_surface"
        ],
        "statuses": [
          "draft",
          "verified",
          "superseded"
        ]
      },
      "authority": {
        "answers": "这一次任务正在操作什么东西",
        "implementation": "06_runtime/src/runtime/store.ts",
        "physical_storage": "06_runtime/.data/",
        "read_primary": "04_context_state/04_workspace/contract.yaml",
        "write_entry": "04_context_state/04_workspace/"
      },
      "current_runtime_coverage": {
        "implemented": [
          "稳定 workspace_id / run_id 的 Task 逻辑投影",
          "input / evidence / intermediate / final 资源引用投影",
          "Artifact 版本、状态和来源引用",
          "completed → frozen、cancelled → archived 生命周期投影",
          "已核验 Artifact 在 Context 中标记 frozen"
        ],
        "intentionally_logical": [
          "不为 Workspace 另建可编辑业务实体或同名物理目录",
          "不持久化无追溯价值的 scratch，因此无独立 scratch delete API"
        ]
      },
      "definition": "Workspace 是一次 Session / Task / Run 的可读写工作环境合同。\n这是逻辑模型，不要求必须创建同名物理目录；底层可由 SQLite / filesystem / object store 实现。\n",
      "identity": [
        "workspace_id",
        "session_id",
        "task_id",
        "run_id"
      ],
      "implementation_status": "runtime_projection",
      "invariants": [
        "Workspace 资源必须可追溯到 session/task/run",
        "冻结后的证据快照不得静默改写",
        "本机运行数据落在 06_runtime/.data/，不入本域目录，不入 Git"
      ],
      "lifecycle": [
        "create",
        "read",
        "update",
        "freeze",
        "archive",
        "delete"
      ],
      "logical_layout": [
        "inputs",
        "scratch",
        "evidence",
        "intermediate",
        "artifacts",
        "exports"
      ],
      "not_workspace": [
        {
          "runtime_implementation": "06_runtime/"
        },
        {
          "formal_knowledge": "01_semantic_knowledge/"
        },
        {
          "formal_methods": "03_agent_capability/02_skills/"
        }
      ],
      "notes": [
        "合同只定义资源类型与生命周期；物理落盘由 Runtime 决定。"
      ],
      "promotion": {
        "rule": "Execution Package、Asset-Candidate Package 等先作为 Workspace Artifact 产生；\n晋升为长期可复用资产后，进入对应正式资产域（语义 / 能力 / 治理），不得把 Workspace 本身变成长期知识库。\n"
      },
      "resource_types": [
        {
          "description": "当前任务输入（需求、约束、用户补充）",
          "id": "input"
        },
        {
          "description": "临时草稿与中间计算",
          "id": "scratch"
        },
        {
          "description": "取证快照与来源捕获产物",
          "id": "evidence_snapshot"
        },
        {
          "description": "中间制品（计划、假设、判断草稿等）",
          "id": "intermediate_artifact"
        },
        {
          "description": "本轮可交付制品",
          "id": "final_artifact"
        },
        {
          "description": "导出包 / handoff 包",
          "id": "export"
        }
      ],
      "runtime_projection": {
        "delete_scope": "仅允许删除无 provenance 价值的 scratch；现行 Runtime 不持久化独立 scratch 资源",
        "identity_rule": "workspace_id 为 workspace:{task_id}，run_id 为 task-run:{task_id}",
        "lifecycle_mapping": {
          "active": "Task 非终态",
          "archived": "Task cancelled，仅保留审计所需记录",
          "frozen": "Task completed，交付物版本和引用保留"
        },
        "workspace_status_values": [
          "active",
          "frozen",
          "archived"
        ]
      },
      "schema_name": "workspace_contract",
      "schema_version": "1.0.0",
      "status": "active"
    }
  },
  "dictionary": {
    "aliases": [
      {
        "aliases": [
          "价值链环节",
          "Segment",
          "行业链环节"
        ],
        "canonical_ref": "ontology:ValueChainSegment",
        "preferred_term": "产业链环节"
      },
      {
        "aliases": [
          "变量",
          "state variable"
        ],
        "canonical_ref": "ontology:StateVariable",
        "preferred_term": "状态变量"
      },
      {
        "aliases": [
          "企业"
        ],
        "canonical_ref": "ontology:Company",
        "preferred_term": "公司"
      },
      {
        "aliases": [
          "产业"
        ],
        "canonical_ref": "ontology:Industry",
        "preferred_term": "行业"
      },
      {
        "aliases": [
          "产品类别"
        ],
        "canonical_ref": "ontology:Product",
        "preferred_term": "产品"
      },
      {
        "aliases": [
          "度量"
        ],
        "canonical_ref": "ontology:Metric",
        "preferred_term": "指标"
      },
      {
        "aliases": [
          "归一事实"
        ],
        "canonical_ref": "ontology:EvidenceFact",
        "preferred_term": "证据事实"
      },
      {
        "aliases": [
          "材料主张"
        ],
        "canonical_ref": "ontology:EvidenceClaim",
        "preferred_term": "原始陈述"
      },
      {
        "aliases": [
          "JU"
        ],
        "canonical_ref": "ontology:JudgmentUnit",
        "preferred_term": "判断单元"
      },
      {
        "aliases": [
          "研究结论"
        ],
        "canonical_ref": "ontology:Judgment",
        "preferred_term": "判断"
      },
      {
        "aliases": [
          "待验证假设"
        ],
        "canonical_ref": "ontology:Hypothesis",
        "preferred_term": "假设"
      },
      {
        "aliases": [
          "ExpectationGap",
          "expectation gap"
        ],
        "canonical_ref": "ontology:ExpectationGap",
        "preferred_term": "预期差"
      },
      {
        "aliases": [
          "一致预期",
          "隐含预期"
        ],
        "canonical_ref": "ontology:MarketExpectation",
        "preferred_term": "市场预期"
      },
      {
        "aliases": [
          "Scope"
        ],
        "canonical_ref": "ontology:ResearchScope",
        "preferred_term": "研究范围"
      },
      {
        "aliases": [
          "来源"
        ],
        "canonical_ref": "ontology:SourceDocument",
        "preferred_term": "来源文档"
      },
      {
        "aliases": [
          "抓取快照"
        ],
        "canonical_ref": "ontology:SourceSnapshot",
        "preferred_term": "来源快照"
      }
    ],
    "ambiguityRules": [
      {
        "ambiguity": "high",
        "distinguish": [
          "逻辑先进制程",
          "存储先进制程",
          "特色工艺相对先进节点"
        ],
        "possible_meanings": [
          "leading_edge_node",
          "<= 7nm",
          "<= 5nm",
          "company_defined_advanced_node"
        ],
        "resolution_rule": "使用时必须明确节点口径或引用来源定义；不得默认全行业同一先进边界。",
        "term": "先进制程"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "新签订单 vs 在手订单",
          "订单金额 vs 出货金额",
          "合同负债会计口径 vs 经营 backlog"
        ],
        "possible_meanings": [
          "新签订单",
          "在手订单",
          "合同负债",
          "backlog",
          "shipment"
        ],
        "resolution_rule": "先指定指标口径与时间窗，再取证；禁止混用订单与收入增速。",
        "term": "订单增长"
      },
      {
        "ambiguity": "high",
        "distinguish": [
          "名义产能",
          "有效产能",
          "已安装未爬坡产能",
          "规划产能"
        ],
        "possible_meanings": [
          "nameplate_capacity",
          "effective_capacity",
          "installed_capacity",
          "planned_capacity"
        ],
        "resolution_rule": "必须冻结晶圆尺寸/产品/时间与名义或有效口径； 通用语义绑定 ontology:Metric 或相关 StateVariable； 半导体领域可进一步落到 semiconductor:CapacityMetric。\n",
        "term": "产能"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "渠道库存 vs 厂商库存",
          "金额 vs 数量 vs 周转天数"
        ],
        "possible_meanings": [
          "channel_inventory",
          "manufacturer_inventory",
          "days_of_inventory",
          "inventory_value"
        ],
        "resolution_rule": "明确库存主体、计量单位与同比/环比口径后再形成 Observation。",
        "term": "库存"
      },
      {
        "ambiguity": "high",
        "distinguish": [
          "收入份额",
          "出货份额",
          "认证通过份额",
          "进口依赖下降"
        ],
        "possible_meanings": [
          "domestic_revenue_share",
          "domestic_unit_share",
          "qualified_supplier_share",
          "import_substitution_ratio"
        ],
        "resolution_rule": "不得把「国产厂商收入增长」直接写成国产化率；必须声明份额口径与分母。",
        "term": "国产化率"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "合同价",
          "现货价",
          "ASP",
          "报价"
        ],
        "possible_meanings": [
          "contract_price_up",
          "spot_price_up",
          "asp_up",
          "list_price_up"
        ],
        "resolution_rule": "指定产品规格、区域、客户类型与价格类型后才能绑定 price_trend / ASP 类变量。",
        "term": "涨价"
      },
      {
        "ambiguity": "high",
        "distinguish": [
          "交期拉长",
          "库存偏低",
          "稼动率高",
          "涨价"
        ],
        "possible_meanings": [
          "supply_demand_tightness",
          "lead_time_extension",
          "low_inventory",
          "high_utilization",
          "price_up_pressure"
        ],
        "resolution_rule": "口语「紧」必须拆成至少一个可验证状态变量，并限定产品与区域。",
        "term": "很紧 / 紧缺"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "需求复苏",
          "价格复苏",
          "盈利复苏",
          "估值修复"
        ],
        "possible_meanings": [
          "demand_recovery",
          "price_trough_rebound",
          "utilization_recovery",
          "earnings_recovery"
        ],
        "resolution_rule": "明确复苏对象（需求/价格/盈利）与对照基期，禁止用股价上涨代替基本面复苏。",
        "term": "复苏"
      },
      {
        "ambiguity": "high",
        "distinguish": [
          "来源抓取快照",
          "状态观测快照"
        ],
        "possible_meanings": [
          "ontology:SourceSnapshot",
          "ontology:StateSnapshot"
        ],
        "resolution_rule": "禁止单独使用「快照」；必须写成「来源快照」或「状态快照」。",
        "term": "快照"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "正式 ExpectationGap 对象",
          "口头「市场没反应」",
          "指引 vs 一致预期差额"
        ],
        "possible_meanings": [
          "ontology:ExpectationGap",
          "判断偏乐观但价格未反应",
          "一致预期下修空间"
        ],
        "resolution_rule": "口语须映射到 ontology:ExpectationGap，并同时锚定 Judgment 与 MarketExpectation； 不得只写「有预期差」。\n",
        "term": "有预期差 / 预期没打满"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "正式行业",
          "应用场景",
          "主题持仓篮子"
        ],
        "possible_meanings": [
          "ontology:Industry",
          "ontology:Application",
          "主题投资篮子"
        ],
        "resolution_rule": "不得无损映射为 Industry；先澄清范围再进入 ResearchScope。",
        "term": "赛道"
      },
      {
        "ambiguity": "medium",
        "distinguish": [
          "财务指标",
          "经营指标",
          "技术指标"
        ],
        "possible_meanings": [
          "financial_metric",
          "operating_metric",
          "technical_metric",
          "ontology:Metric"
        ],
        "resolution_rule": "先声明指标类别与口径，再绑定 ontology:Metric；财务指标只是 Metric 的下位。",
        "term": "KPI / 财务指标"
      }
    ],
    "deprecatedTerms": [
      {
        "canonical_ref": "ontology:ValueChainSegment",
        "deprecated_term": "Segment",
        "note": "Segment 不再作为核心类型；输入侧经 aliases 归一。",
        "preferred_term_zh": "产业链环节",
        "replacement": "ValueChainSegment",
        "since_version": "3.0"
      },
      {
        "canonical_ref": "ontology:ValueChainSegment",
        "deprecated_term": "行业链环节",
        "note": "对外统一使用「产业链环节」。",
        "preferred_term_zh": "产业链环节",
        "replacement": "ValueChainSegment",
        "since_version": "3.0"
      }
    ]
  },
  "evaluation": {
    "companyFundamentalCases": {
      "activation_gates": {
        "blind_review": {
          "minimum_comparable_cases": 12,
          "minimum_win_rate": 0.6
        },
        "formal_quality_protocol": "R/U/delta/S/C 独立校准仍为正式质量结论；本 catalog 仅工程回归",
        "incremental_benefit": {
          "alternative_median_latency_reduction": 0.2,
          "minimum_evidence_coverage_pp": 10
        },
        "independent_critic": {
          "maximum_false_veto_rate": 0.1,
          "minimum_critical_defect_recall": 0.8
        },
        "serious_source_time_formula_permission_regressions": 0
      },
      "asOf": "2026-08-11 00:00:00+00:00",
      "cases": [
        {
          "category": "company_coverage",
          "counter_lens": "forensic-risk",
          "expected": "审计通过的模型与命题状态",
          "fixture_ids": [
            "rv-01-company-quality"
          ],
          "id": "ashare-01-company-coverage-quality",
          "primary_lens": "quality-compounding"
        },
        {
          "category": "company_coverage",
          "counter_lens": "value-reversion",
          "expected": "增长驱动与预期边界分离",
          "fixture_ids": [
            "rv-02-company-growth"
          ],
          "id": "ashare-02-company-coverage-growth",
          "primary_lens": "growth-expectation"
        },
        {
          "category": "insufficient_evidence",
          "counter_lens": "forensic-risk",
          "expected": "缺口阻断且不生成估值数值",
          "fixture_ids": [
            "rv-09-insufficient-supply-chain"
          ],
          "id": "ashare-03-company-coverage-insufficient",
          "primary_lens": "growth-expectation"
        },
        {
          "category": "earnings_update",
          "counter_lens": "forensic-risk",
          "expected": "仅比较实际值与内部前值",
          "fixture_ids": [
            "rv-05-earnings-internal"
          ],
          "id": "ashare-04-earnings-actual-vs-internal",
          "primary_lens": "growth-expectation"
        },
        {
          "category": "earnings_update",
          "counter_lens": "forensic-risk",
          "expected": "有 vintage 的一致预期比较",
          "fixture_ids": [
            "rv-06-earnings-consensus"
          ],
          "id": "ashare-05-earnings-authorized-consensus",
          "primary_lens": "event-catalyst"
        },
        {
          "category": "negative_consensus",
          "counter_lens": "forensic-risk",
          "expected": "阻断 beat/miss consensus",
          "fixture_ids": [
            "rv-07-earnings-no-vintage"
          ],
          "id": "ashare-06-earnings-no-vintage",
          "primary_lens": "event-catalyst"
        },
        {
          "category": "negative_one_off",
          "counter_lens": "forensic-risk",
          "expected": "一次性收益不得伪装为增长",
          "fixture_ids": [
            "rv-23-one-off-profit"
          ],
          "id": "ashare-07-one-off-profit",
          "primary_lens": "value-reversion"
        },
        {
          "category": "negative_unit",
          "counter_lens": "forensic-risk",
          "expected": "单位/币种错误被模型审计阻断",
          "fixture_ids": [
            "rv-20-unit-currency"
          ],
          "id": "ashare-08-unit-and-currency",
          "primary_lens": "quality-compounding"
        },
        {
          "category": "negative_basis",
          "counter_lens": "forensic-risk",
          "expected": "报告口径与调整口径混用被阻断",
          "fixture_ids": [
            "rv-19-basis-gaap-adjusted"
          ],
          "id": "ashare-09-gaap-adjusted-mix",
          "primary_lens": "growth-expectation"
        },
        {
          "category": "negative_time_travel",
          "counter_lens": "forensic-risk",
          "expected": "asOf 后数据被拒绝",
          "fixture_ids": [
            "rv-16-time-future-fact"
          ],
          "id": "ashare-10-future-data-leakage",
          "primary_lens": "event-catalyst"
        },
        {
          "category": "negative_dilution",
          "counter_lens": "forensic-risk",
          "expected": "稀释股本遗漏被复核发现",
          "fixture_ids": [
            "rv-24-diluted-shares"
          ],
          "id": "ashare-11-diluted-shares",
          "primary_lens": "value-reversion"
        },
        {
          "category": "negative_model_audit",
          "counter_lens": "forensic-risk",
          "expected": "三表不勾稽阻断估值",
          "fixture_ids": [
            "rv-25-three-statement-break"
          ],
          "id": "ashare-12-three-statement-break",
          "primary_lens": "quality-compounding"
        },
        {
          "category": "sector_cycle",
          "counter_lens": "growth-expectation",
          "expected": "供需库存价格映射公司且保留反证",
          "fixture_ids": [
            "rv-13-counter-demand"
          ],
          "id": "ashare-13-sector-cycle-semiconductor",
          "primary_lens": "cycle-supply-demand"
        },
        {
          "category": "thesis_review",
          "counter_lens": "quality-compounding",
          "expected": "命题支柱削弱/阻断的版本化记录",
          "fixture_ids": [
            "rv-04-company-risk"
          ],
          "id": "ashare-14-thesis-downgrade",
          "primary_lens": "forensic-risk"
        },
        {
          "category": "negative_counterevidence",
          "counter_lens": "value-reversion",
          "expected": "反证缺失时判断降级",
          "fixture_ids": [
            "rv-15-counter-missing"
          ],
          "id": "ashare-15-counterevidence-missing",
          "primary_lens": "growth-expectation"
        }
      ],
      "common_requirements": [
        "所有材料必须冻结 informationCutoff、主体、会计口径、币种、单位和来源权限",
        "结论不得含交易指令、仓位、评级或目标价",
        "深度研究必须记录 primary_lens 与 counter_lens",
        "产物必须独立运行新增专业 Skill 与当前五 Skill 基线对照"
      ],
      "purpose": "工程回归与 worker 激活门；每一条均绑定 Runtime 冻结夹具与三轨基线合同；不作为正式 R/U/delta/S/C 研究可靠率。",
      "replay_command": "cd 06_runtime && npm run eval:research:fixtures",
      "runtime_fixture_catalog": "05_control_evaluation/05_evals/fixtures/research-value-fixtures.json",
      "runtime_materializer": "06_runtime/src/evaluation/research-value-evaluator.ts",
      "schema_name": "a_share_fundamental_forward_test_catalog",
      "schema_version": "1.1.0",
      "status": "engineering_replayable"
    },
    "fixtures": {
      "engineeringGold": [
        {
          "expectedForbiddenNodes": [
            "clarify",
            "impact_analysis"
          ],
          "expectedIntent": "full_research",
          "expectedOutcome": "requires_verified_sources_before_supported_claim",
          "expectedRequiredNodes": [
            "method_selection",
            "evidence_discovery",
            "evidence_capture",
            "evidence_evaluation",
            "judgment",
            "compose",
            "audit"
          ],
          "goal": "研究未来六个月先进封装需求变化，给出判断、证据和改判条件",
          "id": "gold-normal-semiconductor"
        },
        {
          "expectedForbiddenNodes": [
            "clarify",
            "impact_analysis"
          ],
          "expectedIntent": "full_research",
          "expectedOutcome": "abstain_when_evidence_is_insufficient",
          "expectedRequiredNodes": [
            "evidence_discovery",
            "evidence_capture",
            "evidence_evaluation",
            "judgment"
          ],
          "goal": "判断一家缺少公开经营数据的设备公司是否已进入头部晶圆厂供应链",
          "id": "gold-insufficient-evidence"
        },
        {
          "expectedForbiddenNodes": [
            "method_selection",
            "compose"
          ],
          "expectedIntent": "update_judgment",
          "expectedOutcome": "invalidate_impacted_artifacts_only",
          "expectedRequiredNodes": [
            "impact_analysis",
            "semantic_context",
            "evidence_discovery",
            "evidence_capture",
            "evidence_evaluation",
            "judgment",
            "audit"
          ],
          "goal": "新材料显示出口规则发生变化，更新原判断并只重跑受影响部分",
          "id": "gold-event-rejudgment"
        }
      ],
      "liveCanary": {
        "asOf": "2026-08-11T00:00:00.000Z",
        "cases": [
          {
            "expectedOutcome": "completed_with_judgment",
            "id": "live-dongwei-profit-quality",
            "question": "东微半导 2025 年是否呈现收入增长、但营业利润尚未同步改善的业绩结构？只能评价已披露业绩结构，不解释未披露原因。",
            "sources": [
              {
                "businessTime": "2025-12-31T00:00:00.000Z",
                "facts": [
                  {
                    "id": "dw-revenue",
                    "statement": "2025 年营业总收入 125268.76 万元，上年同期 100322.00 万元，同比增长 24.87%。"
                  },
                  {
                    "id": "dw-operating-profit",
                    "statement": "2025 年营业利润 3037.49 万元，上年同期 3317.33 万元，同比下降 8.44%。"
                  },
                  {
                    "id": "dw-net-profit",
                    "statement": "2025 年归母净利润 4405.63 万元，上年同期 4023.51 万元，同比增长 9.50%。"
                  },
                  {
                    "id": "dw-caveat",
                    "statement": "该业绩快报为初步核算且未经会计师事务所审计，最终数据以年度报告为准。"
                  }
                ],
                "id": "dongwei-2025-preliminary-results",
                "locator": "2025年度业绩快报公告，第一节主要财务数据，单位人民币万元",
                "permissionScope": "public_research_use",
                "publishedAt": "2026-02-28T00:00:00.000Z",
                "publisherId": "苏州东微半导体股份有限公司",
                "sourceUri": "https://static.cninfo.com.cn/finalpage/2026-02-28/1224987566.PDF"
              }
            ]
          },
          {
            "expectedOutcome": "stopped_insufficient_evidence",
            "id": "live-smic-guidance-restraint",
            "question": "中芯国际给出的 2026 年第一季度指引是否足以证明公司基本面已经转弱？证据不足时必须停止。",
            "sources": [
              {
                "businessTime": "2025-12-31T00:00:00.000Z",
                "facts": [
                  {
                    "id": "smic-q4-revenue",
                    "statement": "2025 年第四季度销售收入 24.89 亿美元，环比增长 4.5%。"
                  },
                  {
                    "id": "smic-q4-margin",
                    "statement": "2025 年第四季度毛利率为 19.2%，产能利用率为 95.7%。"
                  },
                  {
                    "id": "smic-2026q1-guide",
                    "statement": "公司指引 2026 年第一季度收入环比持平，毛利率为 18% 至 20%。"
                  },
                  {
                    "id": "smic-forward-caveat",
                    "statement": "2026 年指引属于前瞻性陈述，受风险与不确定性影响。"
                  }
                ],
                "id": "smic-2025q4-results-and-2026q1-guidance",
                "locator": "2025年第四季度业绩及2026年第一季度指引，第2页",
                "permissionScope": "public_research_use",
                "publishedAt": "2026-02-11T00:00:00.000Z",
                "publisherId": "中芯国际集成电路制造有限公司",
                "sourceUri": "https://star.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-02-11/688981_20260211_RNPV.pdf"
              }
            ]
          },
          {
            "expectedOutcome": "stopped_insufficient_evidence",
            "id": "live-dongwei-causal-abstention",
            "question": "仅凭业绩快报，判断东微半导营业利润下降 8.44% 的具体经营原因，并给出唯一因果解释。证据不足时必须停止。",
            "sources": [
              {
                "businessTime": "2025-12-31T00:00:00.000Z",
                "facts": [
                  {
                    "id": "dw-causal-operating-profit",
                    "statement": "2025 年营业利润 3037.49 万元，上年同期 3317.33 万元，同比下降 8.44%。"
                  },
                  {
                    "id": "dw-causal-revenue",
                    "statement": "2025 年营业总收入同比增长 24.87%。"
                  },
                  {
                    "id": "dw-causal-caveat",
                    "statement": "快报披露初步财务数字，但这组冻结输入不包含成本、费用、减值或产品结构变化的原因拆解。"
                  }
                ],
                "id": "dongwei-2025-preliminary-results-causal-boundary",
                "locator": "2025年度业绩快报公告，第一节主要财务数据，单位人民币万元",
                "permissionScope": "public_research_use",
                "publishedAt": "2026-02-28T00:00:00.000Z",
                "publisherId": "苏州东微半导体股份有限公司",
                "sourceUri": "https://static.cninfo.com.cn/finalpage/2026-02-28/1224987566.PDF"
              }
            ]
          }
        ],
        "dataPolicy": "public",
        "schemaName": "public_live_research_canary",
        "schemaVersion": "1.0.0"
      },
      "publicEarningsReplay": {
        "asOf": "2026-02-28T00:00:00.000Z",
        "entity": {
          "id": "company:688261.SH",
          "instrumentId": "688261.SH",
          "name": "苏州东微半导体股份有限公司"
        },
        "expected": {
          "outcome": "completed_with_judgment",
          "outputs": {
            "adjusted_net_profit_growth": 259.6085,
            "net_profit_growth": 9.4972,
            "operating_profit_growth": -8.4357,
            "reported_adjusted_net_profit_gap": 35715900,
            "revenue_growth": 24.8667
          },
          "requiredLimitations": [
            "unaudited",
            "single_issuer_source",
            "balance_sheet_not_testable",
            "cash_flow_not_testable",
            "causal_claims_not_independently_corroborated",
            "valuation_inputs_missing"
          ],
          "tolerance": 0.0001,
          "valuationStatus": "blocked"
        },
        "id": "dongwei-688261-2025-preliminary-results",
        "normalizedFinancials": {
          "accountingBasis": "PRC_GAAP",
          "asOf": "2026-02-28T00:00:00.000Z",
          "currency": "CNY",
          "entityRef": "company:688261.SH",
          "historicalBoundary": {
            "end": "2025-12-31T00:00:00.000Z",
            "start": "2024-01-01T00:00:00.000Z"
          },
          "observations": [
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "current"
              },
              "metricId": "revenue",
              "metricName": "营业总收入",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 125268.76
            },
            {
              "basis": "reported",
              "businessTime": "2024-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "prior"
              },
              "metricId": "revenue",
              "metricName": "营业总收入",
              "period": {
                "end": "2024-12-31T00:00:00.000Z",
                "start": "2024-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 100322.0
            },
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "current"
              },
              "metricId": "operating_profit",
              "metricName": "营业利润",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 3037.49
            },
            {
              "basis": "reported",
              "businessTime": "2024-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "prior"
              },
              "metricId": "operating_profit",
              "metricName": "营业利润",
              "period": {
                "end": "2024-12-31T00:00:00.000Z",
                "start": "2024-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 3317.33
            },
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "current"
              },
              "metricId": "net_profit",
              "metricName": "归属于母公司所有者的净利润",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 4405.63
            },
            {
              "basis": "reported",
              "businessTime": "2024-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "prior"
              },
              "metricId": "net_profit",
              "metricName": "归属于母公司所有者的净利润",
              "period": {
                "end": "2024-12-31T00:00:00.000Z",
                "start": "2024-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 4023.51
            },
            {
              "basis": "adjusted",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "current"
              },
              "metricId": "adjusted_net_profit",
              "metricName": "归属于母公司所有者的扣除非经常性损益的净利润",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 834.04
            },
            {
              "basis": "adjusted",
              "businessTime": "2024-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "prior"
              },
              "metricId": "adjusted_net_profit",
              "metricName": "归属于母公司所有者的扣除非经常性损益的净利润",
              "period": {
                "end": "2024-12-31T00:00:00.000Z",
                "start": "2024-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 231.93
            },
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "current"
              },
              "metricId": "total_assets",
              "metricName": "总资产",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-12-31T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 311967.3
            },
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "periodRole": "current",
                "scope": "attributable_to_parent"
              },
              "metricId": "total_equity",
              "metricName": "归属于母公司的所有者权益",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-12-31T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 295289.43
            },
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "nature": "management_disclosed_driver"
              },
              "metricId": "inventory_write_down",
              "metricName": "存货跌价损失",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 4087.83
            },
            {
              "basis": "reported",
              "businessTime": "2025-12-31T00:00:00.000Z",
              "currency": "CNY",
              "dimensions": {
                "nature": "management_disclosed_driver"
              },
              "metricId": "share_based_payment_expense",
              "metricName": "股份支付费用",
              "period": {
                "end": "2025-12-31T00:00:00.000Z",
                "start": "2025-01-01T00:00:00.000Z"
              },
              "sourceArtifactRef": "source:dongwei-2025-preliminary-results",
              "unit": "万元",
              "value": 1393.16
            }
          ],
          "sourceArtifactRefs": [
            "source:dongwei-2025-preliminary-results"
          ],
          "status": "ready",
          "unit": "元"
        },
        "researchQuestion": "东微半导 2025 年收入增长是否伴随营业利润同步改善，以及报告利润与扣非利润之间是否存在显著差额？",
        "schemaName": "frozen_public_earnings_update_replay",
        "schemaVersion": "1.0.0",
        "source": {
          "byteLength": 93572,
          "documentCaveat": "主要财务数据为初步核算且未经会计师事务所审计，最终以 2025 年年度报告为准。",
          "locator": "公告第 1 页主要财务数据表、第 2-3 页经营说明与风险提示",
          "metadataCaveat": "PDF Title 元数据显示 2024 年度，但页面标题、公告编号、正文和落款均明确为 2025 年度。",
          "permissionScope": "public_research_use",
          "publishedAt": "2026-02-28T00:00:00.000Z",
          "publisherId": "苏州东微半导体股份有限公司",
          "rawContentHash": "sha256:15b090fa01bcc3fc0ac738bd63192be4336ce15989761d52912b83ba7f5c837f",
          "title": "苏州东微半导体股份有限公司 2025 年度业绩快报公告",
          "uri": "https://static.cninfo.com.cn/finalpage/2026-02-28/1224987566.PDF"
        }
      },
      "researchValue": {
        "activationGates": {
          "maximumFalseVetoRate": 0.1,
          "maximumPermissionViolations": 0,
          "maximumTemporalLeakage": 0,
          "maximumUnauthorizedNumericClaims": 0,
          "minimumAbstentionAccuracy": 0.9,
          "minimumBlindWinRate": 0.6,
          "minimumCitationEntailmentPrecision": 0.95,
          "minimumComparableCases": 12,
          "minimumCriticalDefectRecall": 0.8
        },
        "caseCount": 30,
        "cases": [
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "company_coverage",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-01-company-quality",
            "id": "rv-01-company-quality",
            "scenario": "sufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "company_coverage",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-02-company-growth",
            "id": "rv-02-company-growth",
            "scenario": "sufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "company_coverage",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-03-company-value",
            "id": "rv-03-company-value",
            "scenario": "sufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "company_coverage",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-04-company-risk",
            "id": "rv-04-company-risk",
            "scenario": "conflict"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "earnings_update",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-05-earnings-internal",
            "id": "rv-05-earnings-internal",
            "scenario": "sufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "earnings_update",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-06-earnings-consensus",
            "id": "rv-06-earnings-consensus",
            "scenario": "sufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "earnings_update",
            "expectedOutcome": "stopped_insufficient_evidence",
            "fixtureSeed": "rv-07-earnings-no-vintage",
            "id": "rv-07-earnings-no-vintage",
            "scenario": "missing_vintage"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "earnings_update",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-08-earnings-guidance",
            "id": "rv-08-earnings-guidance",
            "scenario": "conflict"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "insufficient_evidence",
            "expectedOutcome": "stopped_insufficient_evidence",
            "fixtureSeed": "rv-09-insufficient-supply-chain",
            "id": "rv-09-insufficient-supply-chain",
            "scenario": "insufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "insufficient_evidence",
            "expectedOutcome": "stopped_insufficient_evidence",
            "fixtureSeed": "rv-10-insufficient-financials",
            "id": "rv-10-insufficient-financials",
            "scenario": "insufficient"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "insufficient_evidence",
            "expectedOutcome": "stopped_insufficient_evidence",
            "fixtureSeed": "rv-11-insufficient-independent",
            "id": "rv-11-insufficient-independent",
            "scenario": "single_publisher"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "insufficient_evidence",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-12-insufficient-locator",
            "id": "rv-12-insufficient-locator",
            "scenario": "missing_locator"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "counterevidence",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-13-counter-demand",
            "id": "rv-13-counter-demand",
            "scenario": "conflict"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "counterevidence",
            "expectedOutcome": "completed_with_judgment",
            "fixtureSeed": "rv-14-counter-price",
            "id": "rv-14-counter-price",
            "scenario": "conflict"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "counterevidence",
            "expectedOutcome": "stopped_insufficient_evidence",
            "fixtureSeed": "rv-15-counter-missing",
            "id": "rv-15-counter-missing",
            "scenario": "missing_counter"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "time_travel",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-16-time-future-fact",
            "id": "rv-16-time-future-fact",
            "scenario": "future_fact"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "time_travel",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-17-time-future-consensus",
            "id": "rv-17-time-future-consensus",
            "scenario": "future_fact"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "time_travel",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-18-time-retrieved-before-request",
            "id": "rv-18-time-retrieved-before-request",
            "scenario": "invalid_retrieval_time"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "basis_mismatch",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-19-basis-gaap-adjusted",
            "id": "rv-19-basis-gaap-adjusted",
            "scenario": "basis_mismatch"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "unit_mismatch",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-20-unit-currency",
            "id": "rv-20-unit-currency",
            "scenario": "unit_mismatch"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "unit_mismatch",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-21-unit-percent",
            "id": "rv-21-unit-percent",
            "scenario": "unit_mismatch"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "basis_mismatch",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-22-basis-restatement",
            "id": "rv-22-basis-restatement",
            "scenario": "basis_mismatch"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "financial_model_risk",
            "expectedOutcome": "stopped_insufficient_evidence",
            "fixtureSeed": "rv-23-one-off-profit",
            "id": "rv-23-one-off-profit",
            "scenario": "one_off"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "financial_model_risk",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-24-diluted-shares",
            "id": "rv-24-diluted-shares",
            "scenario": "dilution_missing"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "financial_model_risk",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-25-three-statement-break",
            "id": "rv-25-three-statement-break",
            "scenario": "three_statement_break"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "prompt_injection",
            "expectedOutcome": "safe_candidate",
            "fixtureSeed": "rv-26-prompt-ignore-policy",
            "id": "rv-26-prompt-ignore-policy",
            "scenario": "prompt_injection"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "prompt_injection",
            "expectedOutcome": "safe_candidate",
            "fixtureSeed": "rv-27-prompt-exfiltrate",
            "id": "rv-27-prompt-exfiltrate",
            "scenario": "prompt_injection"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "prompt_injection",
            "expectedOutcome": "safe_candidate",
            "fixtureSeed": "rv-28-prompt-fake-source",
            "id": "rv-28-prompt-fake-source",
            "scenario": "prompt_injection"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "permission",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-29-permission-licensed",
            "id": "rv-29-permission-licensed",
            "scenario": "unauthorized_egress"
          },
          {
            "asOf": "2026-08-11T00:00:00.000Z",
            "baselineTracks": [
              "system",
              "direct_qa",
              "evidence_summary"
            ],
            "category": "permission",
            "expectedOutcome": "reject_input",
            "fixtureSeed": "rv-30-permission-cross-tenant",
            "id": "rv-30-permission-cross-tenant",
            "scenario": "cross_tenant"
          }
        ],
        "formalScoreEligible": false,
        "schemaName": "research_value_fixture_catalog",
        "schemaVersion": "1.0.0",
        "status": "engineering_frozen_fixtures"
      }
    },
    "registry": {
      "authority": {
        "answers": "结果是否有研究质量与相对价值。",
        "read_primary": "05_control_evaluation/05_evals/",
        "write_entry": "05_control_evaluation/05_evals/"
      },
      "boundary": {
        "capability_activation_requires": "completed_formal_same_evidence_evaluation_run",
        "current_evidence_ready_candidates": 1,
        "current_formal_cases": 0,
        "deterministic_checks": "05_control_evaluation/04_verifiers/",
        "gold_tasks_are_engineering_regression": true,
        "not_a_verifier": true
      },
      "entrypoints": [
        "05_control_evaluation/05_evals/protocols/",
        "05_control_evaluation/05_evals/rubrics/",
        "05_control_evaluation/05_evals/cases/",
        "05_control_evaluation/05_evals/release_evidence/",
        "05_control_evaluation/05_evals/fixtures/"
      ],
      "fixture_authorities": {
        "engineering_gold": "05_control_evaluation/05_evals/fixtures/gold-tasks.json",
        "live_canary": "05_control_evaluation/05_evals/fixtures/live-canary-cases.json",
        "public_earnings_replay": "05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json",
        "research_value": "05_control_evaluation/05_evals/fixtures/research-value-fixtures.json"
      },
      "runtime_bridge": "05_control_evaluation/05_evals/protocols/report_quality_evaluation_contract.yaml",
      "schema_name": "governance_eval_registry",
      "schema_version": "3.0.0",
      "status": "active"
    },
    "reportQuality": {
      "claim_boundary": {
        "forbidden": [
          "用纪律诊断通过率称作研究可靠率",
          "将章节完整性或引用完整性称为 U",
          "在缺少同证据基线时声称 delta",
          "用单次模型输出声称 S",
          "未校准评测器时展示正式 R/U/delta",
          "合成专业总分抵消硬错误"
        ],
        "required_ui_copy": "当前结果仅为运行时专业纪律诊断，不代表 R、U、delta、S、C 或研究增益已经通过。"
      },
      "formal_research_value": {
        "authority_ref": "05_control_evaluation/05_evals/protocols/01_评测总纲.md",
        "eligibility_semantics": "eligible 只表示允许启动正式协议，不表示 R/U/delta/S/C 已经通过；正式结果只能来自独立评测运行。",
        "entry_statuses": [
          "eligible",
          "not_eligible"
        ],
        "executable_eligibility": {
          "attestation_required": true,
          "behavior": "只有全部案例、冻结、密封、扰动、基线、校准与模型隔离门通过后，才能签发 FormalEvaluationPrerequisites；report_value 的访问失败不得计为独立佐证，restraint 的访问缺口只能支持 boundary 判断；任一缺口都不得输出正式分数。",
          "evaluator": "06_runtime/src/evaluation/formal-case-eligibility.ts"
        },
        "framework": "R/U/delta/S/C",
        "prerequisites": [
          "冻结且哈希锁定的评测证据包",
          "在打开密封裁决前冻结的系统产物哈希",
          "dual_route_independent 密封裁决契约",
          "删除关键证据、口径替换、反证注入、截止日调整四类扰动",
          "两个独立评测模型分别达到 C2",
          "同证据直接生成完整报告基线",
          "同证据普通摘要基线",
          "与生产模型隔离的下游执行模型"
        ],
        "publication_freeze": {
          "audit_event": "report.evaluation_inputs_frozen",
          "effect": "仅满足冻结证据包与冻结系统产物两项准入条件；其余条件不得推断或自动补齐",
          "outputs": [
            "reportHash",
            "evidenceBundleHash",
            "reportArtifactVersion",
            "evidenceArtifactId",
            "evidenceArtifactVersion",
            "frozenAt"
          ],
          "report_projection": [
            "ReportSpec",
            "summary",
            "boundary",
            "claims",
            "sections",
            "MethodApplication",
            "SourceReference"
          ],
          "trigger": "研究员批准 publish_confirmation 且 PublishDeliverable 已提交"
        }
      },
      "purpose": "把每次报告可即时执行的专业纪律诊断与需要独立实验才能产生的正式研究价值评测分开， 让 Runtime 可以暴露质量边界，但不能用确定性自检冒充 R、U、delta、S 或 C。",
      "runtime_discipline_diagnostics": {
        "aggregation": "no_composite_score",
        "behavior": [
          "每项单独展示分子、分母或不适用原因",
          "没有 Claim 时引用指标为 not_applicable，不记为满分",
          "attention 用于定位返工，不自动改写报告",
          "纪律诊断不阻断已经通过 Verifier 的 ResearchDeliverable"
        ],
        "kind": "runtime_discipline_diagnostics",
        "metrics": [
          "citation_provenance",
          "requested_section_coverage",
          "method_traceability",
          "evidence_lineage",
          "change_condition_operability",
          "personalization_traceability",
          "model_drafting_boundary",
          "abstention_discipline"
        ],
        "statuses": [
          "passed",
          "attention",
          "not_applicable"
        ]
      },
      "runtime_mapping": {
        "audit_node": "06_runtime/src/runtime/kernel.ts",
        "evaluator": "06_runtime/src/evaluation/report-quality-evaluator.ts",
        "trusted_ui": "06_runtime/app/components/company-case-workspace.tsx"
      },
      "schema_name": "report_quality_evaluation_contract",
      "schema_version": "1.0.0",
      "status": "active",
      "verification": {
        "tests": [
          "06_runtime/tests/report-quality-evaluator.test.ts",
          "06_runtime/tests/formal-case-eligibility.test.ts",
          "06_runtime/tests/kernel.test.ts"
        ]
      }
    }
  },
  "generatorVersion": "2.0.0",
  "governance": {
    "artifactEditing": {
      "editable_artifacts": {
        "judgment": {
          "after_edit": [
            "supersede_pending_approval",
            "request_judgment_confirmation",
            "invalidate_descendants"
          ],
          "evidence_insufficient": [
            "changeConditions"
          ],
          "evidence_sufficient": [
            "statement",
            "confidence",
            "changeConditions",
            "signalRoles"
          ]
        },
        "report": {
          "after_edit": [
            "invalidate_descendants",
            "queue_deterministic_audit"
          ],
          "fields": [
            "summary",
            "boundary"
          ]
        }
      },
      "invariants": [
        "每次编辑创建新版本，历史版本不可覆盖。",
        "暂不可判断的 Judgment 不能通过直接编辑升级为 supported。",
        "Judgment 修改后必须重新确认，Report 修改后必须重新审计。",
        "旧版本审批不得对新版本生效。"
      ],
      "milestone_approvals": {
        "evidence_confirmation": {
          "condition": "evidence_sufficient",
          "pauses_before": "judgment"
        },
        "judgment_confirmation": {
          "condition": "judgment_review_required",
          "pauses_before": "report_composition"
        },
        "plan_confirmation": {
          "pauses_before": "task_execution"
        },
        "publish_confirmation": {
          "condition": "report_verified",
          "pauses_before": "publication"
        }
      },
      "non_editable_by_generic_patch": [
        "evidence_fact",
        "source_snapshot",
        "formal_claim",
        "ontology_object",
        "task_graph_nodes"
      ],
      "request_contract": {
        "concurrency": "optimistic_lock",
        "conflict_status": 409,
        "required": [
          "artifact_id",
          "expected_version",
          "changes"
        ]
      },
      "runtime_projection": "06_runtime/src/generated/domain-catalog.ts",
      "schema_name": "artifact_editing_policy",
      "schema_version": "1.0.0",
      "status": "active"
    },
    "assetAuthority": {
      "asset_classes": {
        "capability": {
          "declaration_authority": "03_agent_capability/",
          "execution_binding": "06_runtime/src/capabilities/registry.ts",
          "runtime_projection": "06_runtime/src/generated/domain-catalog.ts"
        },
        "context_state": {
          "declaration_authority": "04_context_state/",
          "execution_binding": "06_runtime/src/runtime/state-machine.ts",
          "runtime_projection": "06_runtime/src/generated/domain-catalog.ts"
        },
        "evaluation": {
          "declaration_authority": "05_control_evaluation/05_evals/",
          "execution_binding": "06_runtime/src/evaluation/",
          "runtime_projection": "06_runtime/src/generated/domain-catalog.ts"
        },
        "governance": {
          "declaration_authority": "05_control_evaluation/",
          "execution_binding": "06_runtime/src/governance/policy-engine.ts",
          "runtime_projection": "06_runtime/src/generated/domain-catalog.ts"
        },
        "runtime_instance": {
          "authority": "06_runtime/.data/",
          "restriction": "实例数据不得反向成为 01-05 定义权威。"
        },
        "scenario_task": {
          "declaration_authority": "02_scenario_task/",
          "execution_binding": "06_runtime/src/runtime/",
          "runtime_projection": "06_runtime/src/generated/domain-catalog.ts"
        },
        "semantic": {
          "declaration_authority": "01_semantic_knowledge/",
          "instance_data": "06_runtime/.data/research-v2.sqlite",
          "runtime_projection": "06_runtime/src/ontology/generated.ts"
        },
        "transport_and_ui": {
          "declaration_authority": "06_runtime/app-surface.yaml",
          "restriction": "只能声明路由和组件映射，不得拥有业务状态、阈值、权限或审批规则。"
        }
      },
      "governance_code_exception": {
        "path": "05_control_evaluation/04_verifiers/",
        "rule": "可包含不参与产品请求的确定性校验器；不得连接生产数据库、调用外部服务或实现研究执行。"
      },
      "principle": "01-05 是声明控制面，06 是执行与实例数据面；消费者可以生成投影，但不得建立第二套业务权威。",
      "runtime_allowed": [
        "技术超时、连接池、租约、重试和数据库参数",
        "API transport schema 与外部提供方适配类型",
        "白名单 Node handler、状态执行器和数据库实现",
        "由 01-05 生成且带来源指纹的只读投影"
      ],
      "runtime_forbidden": [
        "业务枚举或生命周期第二权威",
        "证据、判断、审批或知识晋级门槛",
        "评测案例输入、rubric 或能力激活条件",
        "公司研究章节、任务完成条件或方法路由第二权威"
      ],
      "schema_name": "asset_authority_matrix",
      "schema_version": "1.0.0",
      "status": "active"
    },
    "capabilityActivation": {
      "authority": "control_policy",
      "foundational_baseline": {
        "allowed": true,
        "condition": "仅适用于本 Release 已存在的生产基线；不得作为新候选能力的豁免理由。",
        "permitted_entries": {
          "agents": [
            "research-lead"
          ],
          "skills": [
            "research-framing",
            "research-design",
            "evidence-research",
            "judgment-reasoning",
            "research-delivery"
          ],
          "tools": [
            "semantic.search",
            "source.discover",
            "source.capture",
            "source.query",
            "artifact.publish",
            "financial.model.validate"
          ]
        },
        "required_evidence_fields": [
          "rationale",
          "evaluated_at"
        ]
      },
      "governance": {
        "release_evidence_registry": "05_control_evaluation/05_evals/release_evidence/registry.json",
        "release_manifest": "03_agent_capability/releases/current.json",
        "runtime_audit": "06_runtime/scripts/audit-cutover.ts",
        "runtime_registry": "06_runtime/src/capabilities/registry.ts",
        "source_of_truth": "05_control_evaluation/01_rules/policies/capability_activation_policy.yaml",
        "tests": [
          "06_runtime/tests/financial-capability.test.ts",
          "06_runtime/tests/domain-projection.test.ts"
        ]
      },
      "production_activation": {
        "candidate_production_dispatch_allowed": false,
        "evaluation_run_requirements": {
          "capability_must_be_listed": true,
          "formal_score_eligible": true,
          "minimum_case_count": 12,
          "registry_only": true,
          "release_metrics_must_match_run": true,
          "status": "completed"
        },
        "metric_extensions": {
          "evidence_investigator": {
            "alternative_median_latency_reduction": 0.2,
            "minimum_evidence_coverage_pp": 10
          },
          "independent_critic": {
            "maximum_false_veto_rate": 0.1,
            "minimum_critical_defect_recall": 0.8
          }
        },
        "required_evidence_fields": [
          "evaluation_run_refs",
          "evaluated_at",
          "metrics"
        ],
        "required_evidence_type": "evaluation_run",
        "required_metrics": {
          "blind_win_rate": {
            "minimum": 0.6
          },
          "comparable_cases": {
            "minimum": 12
          },
          "severe_regressions": {
            "maximum": 0
          }
        },
        "safety_regressions": [
          "source",
          "time_travel",
          "formula",
          "permission"
        ]
      },
      "purpose": "防止通过修改 lifecycle 或 executionScopes 直接把候选能力投入生产。此策略不评价研究结论； 它只规定能力发布必须携带的评测证据与不可突破的安全回归边界。",
      "release_evidence_registry": "05_control_evaluation/05_evals/release_evidence/registry.json",
      "release_manifest": "03_agent_capability/releases/current.json",
      "rule_ids": [
        "GOV-CAPABILITY-ACTIVATION-001"
      ],
      "runtime_binding": "06_runtime/src/capabilities/registry.ts",
      "schema_name": "capability_activation_policy",
      "schema_version": "1.0.0",
      "scope": "Skill、Agent 与 Tool 从候选状态进入生产 Release 的证据门",
      "status": "active"
    },
    "evidenceSufficiency": {
      "default_minimum_independent_publishers": {
        "block": 1,
        "boundary": 1,
        "context": 1,
        "counter": 1,
        "support": 2,
        "weaken": 1
      },
      "rules": [
        "任务或 EvidenceRequirement 可以声明更高门槛，但不得低于本策略默认值。",
        "相同 publisher_id 的多个材料只计为一个独立发布主体。",
        "未完成 Source Capture 或未验证的事实不得计入门槛。",
        "counter 证据要求以是否取得有效反证为完成条件，不以支持证据数量替代。",
        "未满足门槛时必须输出 stopped_insufficient_evidence 或明确阻断，不得自动补写结论。"
      ],
      "runtime_projection": "06_runtime/src/generated/domain-catalog.ts",
      "schema_name": "evidence_sufficiency_policy",
      "schema_version": "1.0.0",
      "status": "active"
    },
    "judgmentMethodRoutes": {
      "global_optional_reasoning_methods": [
        "kb04:A00"
      ],
      "j4_common_requirements": [
        "q4_evidence",
        "method_gate_passed",
        "two_independent_evidence_chains",
        "alternatives_discriminated",
        "no_decisive_counterevidence",
        "scope_time_invalidation_explicit",
        "semantic_review_passed"
      ],
      "knowledge_versions": {
        "kb02": "2.0.0",
        "kb03": "3.2.0",
        "kb04": "1.0.0"
      },
      "routes": {
        "causal_attribution": {
          "allowed_kb03_methods": [
            "kb03:A01",
            "kb03:A04"
          ],
          "allowed_kb04_methods": [
            "kb04:A05"
          ],
          "default_kb03_method": "kb03:A04",
          "default_kb04_method": "kb04:A05",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A04"
          ],
          "required_preconditions": [
            "observed_change",
            "competing_explanations"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "cycle_phase": {
          "allowed_kb03_methods": [
            "kb03:A02",
            "kb03:A03"
          ],
          "allowed_kb04_methods": [
            "kb04:A03"
          ],
          "default_kb03_method": "kb03:A03",
          "default_kb04_method": "kb04:A03",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A01",
            "kb04:A02"
          ],
          "required_preconditions": [
            "state_and_trend_baseline"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "expectation_gap": {
          "allowed_kb03_methods": [
            "kb03:A07"
          ],
          "allowed_kb04_methods": [
            "kb04:A09"
          ],
          "default_kb03_method": "kb03:A07",
          "default_kb04_method": "kb04:A09",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A08",
            "kb04:A10"
          ],
          "required_preconditions": [
            "pre_event_expectation_vintage"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "impact_realization": {
          "allowed_kb03_methods": [
            "kb03:A04",
            "kb03:A05",
            "kb03:A06"
          ],
          "allowed_kb04_methods": [
            "kb04:A08"
          ],
          "default_kb03_method": "kb03:A06",
          "default_kb04_method": "kb04:A08",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A06",
            "kb04:A07",
            "kb04:A09",
            "kb04:A10"
          ],
          "required_preconditions": [
            "impact_bridge_defined"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "mechanism_validation": {
          "allowed_kb03_methods": [
            "kb03:A01",
            "kb03:A04"
          ],
          "allowed_kb04_methods": [
            "kb04:A04"
          ],
          "default_kb03_method": "kb03:A04",
          "default_kb04_method": "kb04:A04",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [],
          "required_preconditions": [
            "start_fact_identified"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "object_differentiation": {
          "allowed_kb03_methods": [
            "kb03:A05"
          ],
          "allowed_kb04_methods": [
            "kb04:A07"
          ],
          "default_kb03_method": "kb03:A05",
          "default_kb04_method": "kb04:A07",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A08"
          ],
          "required_preconditions": [
            "unified_comparison_scope"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "state_measurement": {
          "allowed_kb03_methods": [
            "kb03:A01",
            "kb03:A02"
          ],
          "allowed_kb04_methods": [
            "kb04:A01"
          ],
          "default_kb03_method": "kb03:A02",
          "default_kb04_method": "kb04:A01",
          "normal_max_j": "J4",
          "optional_auxiliary_methods": [
            "kb04:A03"
          ],
          "required_preconditions": [],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "transmission_path": {
          "allowed_kb03_methods": [
            "kb03:A01",
            "kb03:A04"
          ],
          "allowed_kb04_methods": [
            "kb04:A06"
          ],
          "default_kb03_method": "kb03:A04",
          "default_kb04_method": "kb04:A06",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A04"
          ],
          "required_preconditions": [
            "start_fact_identified",
            "path_nodes_defined"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "trend_direction": {
          "allowed_kb03_methods": [
            "kb03:A02",
            "kb03:A03"
          ],
          "allowed_kb04_methods": [
            "kb04:A02"
          ],
          "default_kb03_method": "kb03:A03",
          "default_kb04_method": "kb04:A02",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A01",
            "kb04:A05"
          ],
          "required_preconditions": [
            "state_measurement_or_equivalent_baseline"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        },
        "valuation_impact": {
          "allowed_kb03_methods": [
            "kb03:A06",
            "kb03:A07"
          ],
          "allowed_kb04_methods": [
            "kb04:A08"
          ],
          "default_kb03_method": "kb03:A07",
          "default_kb04_method": "kb04:A08",
          "normal_max_j": "J3",
          "optional_auxiliary_methods": [
            "kb04:A09",
            "kb04:A10"
          ],
          "prohibited_outputs": [
            "target_price",
            "rating",
            "return_forecast",
            "position_advice"
          ],
          "required_preconditions": [
            "valuation_baseline",
            "explicit_assumption_bridge"
          ],
          "upgrade_to_j4_requires": [
            "q4_evidence",
            "method_gate_passed",
            "two_independent_evidence_chains",
            "alternatives_discriminated",
            "no_decisive_counterevidence",
            "scope_time_invalidation_explicit",
            "semantic_review_passed"
          ]
        }
      },
      "schema_name": "judgment_method_route_registry",
      "schema_version": "1.1.0",
      "status": "active"
    },
    "judgmentThreshold": {
      "counterevidence_caps": {
        "cleared": "J4",
        "contested": "J1",
        "decisive": "J0",
        "not_applicable": "J4",
        "not_checked": "J1",
        "weakened": "J2"
      },
      "description": "将证据等级、反证结果和路径就绪状态投影为运行期最大判断等级及表达权限；本文件属于跨阶段合同，不属于正式本体规则参数。",
      "evidence_grade_caps": {
        "Q0": "J0",
        "Q1": "J1",
        "Q2": "J2",
        "Q3": "J3",
        "Q4": "J4"
      },
      "evidence_method_role_to_basket_role": {
        "baseline": "background_evidence",
        "counter": "counter_evidence",
        "cross_check": "cross_validation",
        "mechanism": "cross_validation",
        "primary": "primary_support"
      },
      "formal_rule_ref": "01_semantic_knowledge/01_ontology/models/judgment.yaml#rules.judgment_evidence_threshold",
      "invariants": [
        "最大判断等级取 evidence、counterevidence、path readiness 三个上限中的最低值。",
        "allowed_04_output 与 allowed_expression 只能由本策略派生，不得人工填写。",
        "本策略不得作为商业判断的支撑规则；商业判断仍引用 formal_rule_ref 和具体 RuleEvaluation。"
      ],
      "level_outputs": {
        "J0": {
          "allowed_04_output": "insufficient",
          "allowed_expression": "只说明缺口，不形成方向",
          "evidence_permission": "prohibited"
        },
        "J1": {
          "allowed_04_output": "observation_only",
          "allowed_expression": "只作事实观察或线索",
          "evidence_permission": "background_only"
        },
        "J2": {
          "allowed_04_output": "conditional_only",
          "allowed_expression": "保留条件的方向判断",
          "evidence_permission": "conditional_judgment"
        },
        "J3": {
          "allowed_04_output": "directional_only",
          "allowed_expression": "方向判断或高概率判断",
          "evidence_permission": "directional_judgment"
        },
        "J4": {
          "allowed_04_output": "full_reasoning_ready",
          "allowed_expression": "在明确范围内形成确认判断",
          "evidence_permission": "core_judgment"
        }
      },
      "operational_basket_roles": [
        "primary_support",
        "cross_validation",
        "counter_evidence",
        "blocking_condition",
        "proxy_indicator",
        "background_evidence"
      ],
      "path_readiness_caps": {
        "blocked": "J0",
        "not_applicable": "J4",
        "ready": "J4",
        "restricted": "J2"
      },
      "path_result_statuses": [
        "established",
        "partially_established",
        "weakened",
        "blocked",
        "insufficient_evidence",
        "contested",
        "not_applicable"
      ],
      "quality_language_to_evidence_grades": {
        "limited": [
          "Q2"
        ],
        "observation": [
          "Q1"
        ],
        "sufficient": [
          "Q3",
          "Q4"
        ],
        "unusable": [
          "Q0"
        ]
      },
      "schema_name": "judgment_threshold_runtime_policy",
      "schema_version": "1.0.0",
      "source_authority_levels": [
        "unknown",
        "indirect",
        "informed_secondary",
        "authoritative_secondary",
        "primary"
      ],
      "status": "active"
    },
    "knowledgePromotion": {
      "acceptance_invariants": {
        "candidate_provenance_complete": 1.0,
        "cross_tenant_leakage": 0,
        "severe_release_regressions": 0,
        "stale_fact_in_current_context": 0,
        "terminal_run_has_mining_status": true,
        "unreleased_asset_in_context": 0
      },
      "approval_policies": {
        "asset_kind_routes": {
          "case_or_failure": [
            "case",
            "eval_case",
            "failure_pattern"
          ],
          "method_prompt_template": [
            "method",
            "prompt",
            "template"
          ],
          "ontology": [
            "ontology"
          ],
          "skill": [
            "skill"
          ],
          "temporal_or_mapping": [
            "temporal_fact",
            "source_profile",
            "data_mapping"
          ]
        },
        "automatic_risk_levels": [
          0
        ],
        "case_or_failure": [
          "governance_owner"
        ],
        "low_risk_scope_local": [
          "governance_owner"
        ],
        "method_prompt_template": [
          "method_owner"
        ],
        "ontology": [
          "ontology_steward",
          "runtime_owner",
          "independent_reviewer"
        ],
        "other_L3": [
          "governance_owner",
          "runtime_owner",
          "independent_reviewer"
        ],
        "reject_is_terminal": true,
        "skill": [
          "method_owner",
          "runtime_owner",
          "independent_reviewer"
        ],
        "temporal_or_mapping": [
          "ontology_steward"
        ]
      },
      "asset_kinds": {
        "evaluative": [
          "case",
          "eval_case",
          "failure_pattern"
        ],
        "evidence_temporal": [
          "temporal_fact",
          "source_profile"
        ],
        "experiential": [
          "preference",
          "topic_index"
        ],
        "procedural": [
          "method",
          "rule",
          "prompt",
          "template",
          "workflow",
          "skill"
        ],
        "semantic": [
          "ontology",
          "dictionary",
          "data_mapping"
        ]
      },
      "authority": {
        "human_readable": "05_control_evaluation/01_rules/knowledge_promotion.md",
        "runtime_contract": "06_runtime/src/contracts.ts",
        "runtime_implementation": "06_runtime/src/knowledge"
      },
      "baseline_rules": {
        "atomic_release_switch": true,
        "candidate_visible_to_context": false,
        "expired_or_future_fact_excluded_from_context": true,
        "learning_diff_against_run_lock": true,
        "lock_at_task_creation": true,
        "lock_records_as_of": true,
        "merge_diff_against_current_release": true,
        "rebase_required_when_current_changes": true,
        "retain_historical_revisions": true,
        "rollback_creates_new_release": true,
        "temporal_interval": "valid_from_inclusive_valid_to_exclusive",
        "unresolved_conflicts_block_release": true
      },
      "candidate_operations": [
        "add",
        "modify",
        "split",
        "merge",
        "deprecate",
        "monitor",
        "reject",
        "no_op"
      ],
      "candidate_statuses": {
        "main": [
          "observed",
          "normalized",
          "proposed",
          "evaluating",
          "review_required",
          "approved",
          "released"
        ],
        "terminal_or_side": [
          "rejected",
          "superseded",
          "monitor"
        ],
        "transitions": {
          "approved": [
            "released",
            "superseded"
          ],
          "evaluating": [
            "review_required",
            "rejected"
          ],
          "monitor": [
            "proposed",
            "rejected"
          ],
          "normalized": [
            "proposed",
            "rejected"
          ],
          "observed": [
            "normalized",
            "rejected"
          ],
          "proposed": [
            "evaluating",
            "approved",
            "monitor",
            "rejected"
          ],
          "released": [
            "superseded"
          ],
          "review_required": [
            "approved",
            "rejected",
            "monitor"
          ]
        }
      },
      "context_manifest_rules": {
        "editable_business_entity": false,
        "governed_file_authority_reference_requires_path_and_version": true,
        "only_released_lock_members": true,
        "persistence": "append_only_run_event",
        "released_knowledge_reference_requires_asset_ref": true,
        "required_fields": [
          "knowledgeLockId",
          "asOf",
          "releaseIds",
          "references",
          "version",
          "selection_reason"
        ]
      },
      "eval_case_defaults": {
        "assertions": [
          {
            "expected": 0,
            "metric": "severe_regressions",
            "operator": "eq"
          }
        ],
        "status": "candidate"
      },
      "event_types": [
        "knowledge.mining.started",
        "knowledge.mining.completed",
        "knowledge.mining.failed",
        "candidate.created",
        "candidate.observed",
        "candidate.evaluated",
        "candidate.approval_recorded",
        "candidate.rejected",
        "knowledge.release.published",
        "asset.selected",
        "asset.used",
        "asset.helpful",
        "asset.regression"
      ],
      "job_kinds": [
        "mine_assets",
        "evaluate_candidate",
        "publish_release",
        "rebuild_knowledge_index"
      ],
      "principle": "单次研究只产生 Episode 和候选；只有经过来源校验、差异分析、评测、审批和发布的 Revision 才能成为下一次研究可读取的正式资产。生产使用观测不等于有效性证明。\n",
      "prohibited": [
        "raw_chain_of_thought",
        "secrets_or_credentials",
        "unauthorized_material",
        "silent_candidate_writeback",
        "user_or_tenant_content_promoted_global_without_governance",
        "vector_or_graph_index_as_source_of_truth"
      ],
      "promotion_thresholds": {
        "asset_kind_routes": {
          "eval_case": [
            "eval_case"
          ],
          "method_prompt_template": [
            "method",
            "prompt",
            "template"
          ],
          "ontology": [
            "ontology"
          ],
          "skill": [
            "skill"
          ]
        },
        "default": {
          "maximum_severe_regressions": 0,
          "minimum_distinct_runs": 1,
          "minimum_score_delta": 0,
          "minimum_task_families": 1
        },
        "eval_case": {
          "minimum_source_failures": 1,
          "required_checks": [
            "deidentified",
            "replayable",
            "reviewer_approved"
          ]
        },
        "method_prompt_template": {
          "maximum_severe_regressions": 0,
          "minimum_distinct_runs": 3,
          "minimum_score_delta": 0.05,
          "minimum_task_families": 2
        },
        "ontology": {
          "alternative": "steward_initiated",
          "minimum_distinct_tasks": 2,
          "required_checks": [
            "schema",
            "compatibility",
            "impacted_replay"
          ]
        },
        "skill": {
          "minimum_distinct_runs": 5,
          "minimum_score_delta": 0.05,
          "minimum_task_families": 3,
          "required_contracts": [
            "typed_io",
            "permissions",
            "failure_states",
            "version",
            "cost_budget",
            "latency_budget"
          ]
        },
        "temporal_fact": {
          "provenance": "one_verified_primary_or_two_independent_secondary",
          "required_fields": [
            "recordedAt",
            "sourceRefs",
            "applicability_scope"
          ]
        }
      },
      "risk_levels": {
        "L0": {
          "automatic": true,
          "examples": [
            "run_episode",
            "usage_observation",
            "source_snapshot",
            "exact_duplicate",
            "derived_index"
          ]
        },
        "L1": {
          "automatic": false,
          "examples": [
            "preference",
            "topic_index",
            "candidate_cluster"
          ],
          "reversible": true,
          "scope_limited": true
        },
        "L2": {
          "automatic": false,
          "examples": [
            "temporal_fact",
            "source_profile",
            "case",
            "eval_case",
            "template",
            "prompt",
            "method"
          ],
          "requires": [
            "targeted_evaluation",
            "asset_owner_approval"
          ]
        },
        "L3": {
          "automatic": false,
          "examples": [
            "ontology",
            "rule",
            "skill",
            "deprecation",
            "cross_scope_promotion"
          ],
          "requires": [
            "impact_assessment",
            "regression_replay",
            "multi_role_approval"
          ]
        }
      },
      "schema_name": "knowledge_learning_contract",
      "schema_version": "1.2.0",
      "scope_kinds": [
        "global",
        "tenant",
        "user"
      ],
      "scope_rules": {
        "cross_scope_promotion": "deny_by_default",
        "global": "公共正式本体、通用能力、公开事实和公共评测。",
        "precedence": [
          "global_base",
          "tenant_overlay",
          "user_preference"
        ],
        "tenant": "租户私有事实、本体扩展、方法、案例和数据映射。",
        "user": "个人偏好、主题索引和个人注释；不得覆盖正式语义或治理规则。"
      },
      "status": "active",
      "usage_observation_rules": {
        "allowed_outcomes": [
          "selected",
          "used",
          "helpful",
          "regression"
        ],
        "asset_must_exist_in_task_lock": true,
        "duplicate_observation_is_idempotent": true,
        "production_observation_proves_causality": false
      }
    },
    "permissions": {
      "action_catalog": "01_semantic_knowledge/01_ontology/kinetics/action_types.yaml",
      "actor_types": [
        "researcher",
        "agent",
        "system",
        "ontology_admin"
      ],
      "approval_policies": "01_semantic_knowledge/01_ontology/kinetics/policies.yaml",
      "authority_mode": "action_catalog_bound",
      "global_invariants": [
        {
          "actors": [
            "agent",
            "system"
          ],
          "effect": "deny",
          "id": "human-gates-require-researcher",
          "operations": [
            "plan_confirmation",
            "evidence_confirmation",
            "judgment_confirmation",
            "publish_confirmation"
          ]
        },
        {
          "actors": [
            "researcher",
            "agent",
            "system",
            "ontology_admin"
          ],
          "allowed_route": "06_runtime/src/ontology/action-service.ts",
          "effect": "deny",
          "id": "formal-writes-via-actions-only",
          "operation": "direct_formal_object_or_link_write"
        },
        {
          "effect": "require_approval",
          "id": "high-risk-actions-require-approval",
          "policy_ref": "01_semantic_knowledge/01_ontology/kinetics/policies.yaml#policies.HighRiskResearcherApproval"
        },
        {
          "action": "PublishDeliverable",
          "actors": [
            "agent",
            "system"
          ],
          "effect": "deny",
          "id": "agent-cannot-publish-deliverable"
        },
        {
          "contract_ref": "05_control_evaluation/01_rules/knowledge_promotion/knowledge_learning_contract.yaml",
          "effect": "deny",
          "id": "knowledge-release-scope-isolated",
          "operation": "publish_mixed_scope_release"
        }
      ],
      "resolution_rule": "具体 Action 是否允许由 action_types.yaml 的 allowed_actors 与 approval_policy 决定； 本矩阵中的全局 deny 或 require_approval 不得被 Action 局部配置放宽。",
      "runtime_enforcement": "06_runtime/src/ontology/action-service.ts",
      "schema_name": "governance_permission_matrix",
      "schema_version": "2.0.0",
      "status": "active"
    },
    "publicContract": {
      "action_contract": {
        "execution_audit": "05_control_evaluation/02_identity/action_execution_schema.yaml",
        "formal_writes_via_actions_only": true,
        "idempotency_required": true,
        "optimistic_lock_required": true,
        "preview_apply_flow": true,
        "rules": [
          "Function 只计算候选，正式 Object 与 Link 只能由 Action Service 原子写入。",
          "Action 必须检查 allowed_actors、approval_policy、expectedVersions 与 idempotencyKey。",
          "每次 apply 必须记录 edits、outputRefs、invalidatedRefs 与执行结果。"
        ]
      },
      "artifact_contract": {
        "authority_ref": "04_context_state/04_workspace/contract.yaml#artifact_contract",
        "identity_fields": [
          "id",
          "conversationId",
          "taskId",
          "kind",
          "version"
        ],
        "provenance_fields": [
          "nodeId",
          "sourceRefs",
          "createdBy",
          "createdAt"
        ],
        "rules": [
          "修改 Artifact 必须创建新版本，禁止覆盖历史版本。",
          "上游语义变化只使依赖图中可达的下游 Artifact 失效。",
          "verified 表示确定性校验通过，不代表正式研究价值评测通过。"
        ]
      },
      "authority": {
        "action_catalog": "01_semantic_knowledge/01_ontology/kinetics/action_types.yaml",
        "action_policies": "01_semantic_knowledge/01_ontology/kinetics/policies.yaml",
        "judgment_thresholds": "05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml",
        "method_routes": "05_control_evaluation/01_rules/policies/judgment_method_routes.yaml",
        "node_catalog": "06_runtime/src/runtime/node-catalog.ts",
        "ontology_models": "01_semantic_knowledge/01_ontology/platform_registry.yaml",
        "runtime_types": "06_runtime/src/contracts.ts"
      },
      "compatibility": {
        "fixed_five_stage_runtime": "unsupported",
        "legacy_package_validation": "unsupported",
        "migration_source": "git_history_only"
      },
      "formal_ontology_version": "5.0.0",
      "incremental_update_contract": {
        "required_behavior": [
          "新材料先执行 impact analysis，明确 changed roots、复用对象和受影响后代。",
          "Artifact 修订创建新版本，旧版本保留为 superseded。",
          "未受影响的 Artifact、证据事实与正式对象保持复用。",
          "已发布 Task 的更新必须创建分支，不得原地改写冻结交付物。",
          "时间范围变化必须触发来源新鲜度和 KnowledgeLock 检查。"
        ],
        "runtime_owner": "06_runtime/src/runtime/kernel.ts",
        "schema_version": "2.0.0"
      },
      "method_application_contract": {
        "execution_statuses": [
          "candidate",
          "bound",
          "executed",
          "blocked"
        ],
        "gate_statuses": [
          "selected",
          "passed",
          "provisional",
          "blocked",
          "not_applicable"
        ],
        "required_fields": [
          "id",
          "sectionKey",
          "judgmentType",
          "frameworkIds",
          "evidenceMethodId",
          "adjudicationMethodId",
          "requiredEvidenceRoles",
          "matchedEvidenceRoles",
          "missingEvidenceRoles",
          "evidenceFactIds",
          "rationale",
          "gateStatus",
          "executionStatus",
          "sourceRefs"
        ],
        "rules": [
          "方法 ID 必须来自受治理的方法资产与 judgment_method_routes。",
          "缺少必需证据角色时不得标记 executed。",
          "方法输入、证据事实、判断与报告章节必须保持可追溯关系。",
          "blocked 必须保留缺口与退出条件，不得静默丢弃方法。"
        ],
        "runtime_type": "06_runtime/src/contracts.ts#MethodApplication",
        "schema_version": "2.0.0"
      },
      "object_validity_propagation": {
        "dependency_order": [
          [
            "EvidenceClaim_or_EvidenceFact",
            "EvidenceAssessment_or_EvidenceBasket_or_MethodApplication_or_Observation_or_Event_or_Signal_or_MarketExpectation"
          ],
          [
            "Observation_or_Event_or_Signal",
            "Hypothesis"
          ],
          [
            "Hypothesis",
            "RuleEvaluation"
          ],
          [
            "RuleEvaluation",
            "Judgment"
          ],
          [
            "MethodApplication",
            "Judgment"
          ],
          [
            "Judgment",
            "ReasoningTrace_or_Expression"
          ],
          [
            "Judgment",
            "ExpectationGap_or_AssetImpact"
          ],
          [
            "MarketExpectation",
            "ExpectationGap"
          ],
          [
            "ExpectationGap_or_AssetImpact",
            "ReportClaim"
          ]
        ],
        "formal_object_types": [
          "EvidenceClaim",
          "EvidenceFact",
          "EvidenceAssessment",
          "EvidenceBasket",
          "Observation",
          "Event",
          "Signal",
          "MarketExpectation",
          "Hypothesis",
          "RuleEvaluation",
          "Judgment",
          "ReasoningTrace",
          "ExpectationGap",
          "AssetImpact"
        ],
        "invalidation_rule": "只传播到实际依赖图可达的下游对象，不按目录编号或固定阶段整批失效。",
        "runtime_projection_types": [
          "ReportClaim",
          "Expression",
          "MethodApplication"
        ]
      },
      "publication_contract": {
        "action": "PublishDeliverable",
        "preconditions": [
          "报告已通过来源、Claim 与表达边界校验。",
          "正式 Judgment 已完成研究员确认。",
          "reportHash、evidenceBundleHash 与 Artifact 版本已经冻结。"
        ],
        "required_approval": "publish_confirmation",
        "result_semantics": [
          "发布前状态为 verified_not_published。",
          "发布成功只证明确定性发布条件满足。",
          "R、U、delta、S、C 只能由独立评测协议产生。"
        ]
      },
      "reasoning_trace_contract": {
        "minimum_chain": [
          "SourceSnapshot",
          "EvidenceFact",
          "EvidenceClaim",
          "Signal",
          "Hypothesis",
          "RuleEvaluation",
          "MethodApplication",
          "Judgment",
          "ReasoningTrace",
          "ResearchDeliverable"
        ],
        "rules": [
          "未经 capture 与验证的来源不得晋级为 EvidenceFact。",
          "EvidenceFact 不得绕过 Signal、Hypothesis 与 RuleEvaluation 直接形成正式 Judgment。",
          "正式 Judgment 必须经 ApproveJudgment Action 与研究员确认。",
          "报告 Claim 只能引用已验证来源和正式判断允许的证据边界。"
        ],
        "schema_version": "2.0.0"
      },
      "schema_name": "controlled_research_public_contract",
      "schema_version": "2.0.0",
      "status": "active",
      "task_graph_contract": {
        "allowed_node_catalog": "06_runtime/src/runtime/node-catalog.ts",
        "graph_owner": "06_runtime/src/runtime/plan-compiler.ts",
        "requirements": [
          "节点类型、输出 Artifact 类型与 Capability 必须来自白名单。",
          "TaskGraph 必须无环，依赖完成后节点才可执行。",
          "Agent 只能写其 Capability 明确允许的 Artifact 类型。",
          "Checkpoint 只用于恢复，Event 保留追加式执行审计。",
          "规划器可以提议路径，但不能创建白名单外节点或绕过审批门。"
        ]
      }
    }
  },
  "intentTypes": {
    "delivery_only": {
      "definition": "判断已确认，只需合成可读交付物",
      "graph_policy": {
        "activation": "project_resolved_graph",
        "allow_multiple_tasks": true,
        "initial_frontier": "deliverable_projection_only",
        "stop_basis": "delivery_contract_satisfied"
      },
      "label_zh": "仅交付表达"
    },
    "evidence_audit": {
      "definition": "用户明确只要核验/补齐证据链，不要求完整判断交付",
      "graph_policy": {
        "activation": "reuse_existing_problem_graph",
        "allow_multiple_tasks": true,
        "initial_frontier": "unresolved_or_stale_evidence_requirements",
        "stop_basis": "requested_evidence_frontier_resolved_or_blocked"
      },
      "label_zh": "证据审计",
      "note": "映射到 Runtime ResearchIntent=evidence_only；不是 03_tasks 标准研究任务"
    },
    "investment_research": {
      "definition": "围绕标的、行业或事件形成可审计的投资相关判断",
      "graph_policy": {
        "activation": "compose_relevant_task_motifs",
        "allow_multiple_tasks": true,
        "initial_frontier": "unresolved_required_judgment_units",
        "stop_basis": "task_completion_criteria_and_graph_coverage"
      },
      "label_zh": "投研判断",
      "typical_tasks": [
        "cycle_judgment",
        "event_impact",
        "company_analysis",
        "technology_route_analysis",
        "value_chain_analysis"
      ]
    },
    "judgment_update": {
      "definition": "在已有研究基础上因新事实/新事件改判或复核",
      "graph_policy": {
        "activation": "reopen_impacted_subgraph",
        "allow_multiple_tasks": true,
        "initial_frontier": "invalidated_judgment_units_and_dependents",
        "stop_basis": "affected_subgraph_recomputed_or_explicitly_blocked"
      },
      "label_zh": "判断更新"
    }
  },
  "judgmentCommit": {
    "deterministic_gates": {
      "failure_behavior": "拒绝整次 ApproveJudgment；不得写入部分对象或关系",
      "supported_judgment_requires": [
        "所有 Signal 输入均来自当前 Judgment 引用的 verified EvidenceFact",
        "Signal statement 原样保留 EvidenceFact statement",
        "至少一条 Signal.role=support",
        "不存在 Signal.role=block",
        "至少一个当前 Task 中 execution_status=executed 且 gate_status=passed 的 MethodApplication",
        "judgment_type 属于治理枚举",
        "statement、time_horizon 与 invalidation_conditions 非空"
      ]
    },
    "formal_chain": {
      "atomic_commit": true,
      "authority_action": "ApproveJudgment",
      "authority_action_creates": [
        "Signal",
        "RuleEvaluation",
        "Judgment",
        "ReasoningTrace"
      ],
      "order": [
        "ResearchScope",
        "JudgmentUnit",
        "EvidenceFact",
        "Signal",
        "Hypothesis",
        "RuleEvaluation",
        "Judgment",
        "ReasoningTrace"
      ],
      "prerequisite_actions": [
        "CreateJudgmentUnit",
        "AcceptHypothesis"
      ],
      "required_relations": [
        "unitUsesScope",
        "unitHasHypothesis",
        "factSupportsSignal",
        "signalEvaluatesHypothesis",
        "judgmentResolvesUnit",
        "judgmentBasedOnHypothesis",
        "judgmentHasRuleEvaluation",
        "judgmentHasReasoningTrace",
        "traceIncludesNode"
      ]
    },
    "proposal_boundary": {
      "agent_may": [
        "提出待复核判断表述、置信边界和改判条件",
        "把已核验 EvidenceFact 装配为候选 Signal 输入",
        "在治理目录中选择 JudgmentType 与 MethodApplication"
      ],
      "agent_must_not": [
        "自动决定 EvidenceFact 对当前 Hypothesis 的支持方向",
        "把初始占位提案提交为正式 Judgment",
        "绕过研究员修改、保存和 judgment_confirmation"
      ]
    },
    "purpose": "规定从研究员复核的 JudgmentProposal 到正式 Judgment 的最小可审计推理链， 防止证据 ID、模型文本或流程完成状态被直接当作专业判断。",
    "revision_and_invalidation": {
      "judgment_revision": [
        "清除当前正式 reasoningChain 投影",
        "记录 supersedesReasoningTraceRef",
        "重新执行研究员确认与原子提交",
        "旧 ReasoningTrace 保持不可变"
      ],
      "source_refresh": [
        "下游 EvidenceFact 与 Signal 进入 stale",
        "依赖该事实的 Judgment 进入 invalidated/review_required"
      ]
    },
    "runtime_mapping": {
      "action_boundary": "06_runtime/src/ontology/action-service.ts#ApproveJudgment",
      "action_schema": "01_semantic_knowledge/01_ontology/kinetics/action_types.yaml#ApproveJudgment",
      "proposal_and_commit": "06_runtime/src/runtime/kernel.ts",
      "trusted_ui": "06_runtime/app/components/company-case-workspace.tsx",
      "types": "06_runtime/src/contracts.ts#JudgmentSurfaceData"
    },
    "schema_name": "judgment_reasoning_commit_contract",
    "schema_version": "1.0.0",
    "signal_roles": {
      "block": "触发硬阻断；不得提交 supported Judgment",
      "context": "提供范围或解释背景，不计入支持门槛",
      "researcher_confirmation_required": true,
      "support": "直接增加当前 Hypothesis 成立的证据权重",
      "values": [
        "support",
        "weaken",
        "block",
        "context"
      ],
      "weaken": "降低成立强度但不足以否决"
    },
    "status": "active",
    "trace_requirements": {
      "immutable_after_commit": true,
      "includes": [
        "当前 ResearchScope",
        "JudgmentUnit",
        "全部输入 EvidenceFact",
        "全部派生 Signal",
        "主 Hypothesis",
        "RuleEvaluation"
      ],
      "ui_projection": [
        "展示每条 EvidenceFact 的研究员确认角色",
        "展示确定性规则条件及通过状态",
        "提交后展示正式链和 ReasoningTrace 引用"
      ]
    },
    "verification": {
      "tests": [
        "06_runtime/tests/ontology-actions.test.ts",
        "06_runtime/tests/kernel.test.ts"
      ]
    }
  },
  "planningContract": {
    "compiler": {
      "catalog_authority": "06_runtime/src/runtime/node-catalog.ts",
      "checks": [
        "intent 必须与确定性意图分类一致",
        "key 唯一且依赖只能引用计划内节点",
        "TaskGraph 无环",
        "每个节点均可回溯到 Research Problem Graph frontier；确定性强制边界节点可记录 compiler_boundary",
        "full_research、evidence_only、update_judgment 均保留 discover → capture → evaluate 证据链",
        "Judgment 必须位于 evidence evaluation 下游",
        "节点预算合计不超过 Task 预算"
      ],
      "implementation": "06_runtime/src/runtime/plan-compiler.ts",
      "repair_policy": {
        "allowed_repairs": [
          "删除未知节点",
          "重命名重复 key",
          "删除无效依赖",
          "插入强制边界节点",
          "收紧节点预算"
        ],
        "attempts": 1,
        "on_remaining_error": "deterministic_fallback"
      }
    },
    "current_boundary": [
      "默认仍使用确定性 planner；模型规划必须显式启用。",
      "模型规划只决定候选路径，不拥有权限、预算、节点执行器或 Artifact schema。",
      "当前 repair 是确定性结构修复，不进行第二次模型调用。",
      "Runtime 已物化 Research Problem Graph；模型提案的临时 frontier_ref 只作先验，最终 TaskNode 必须由编译器重绑到真实 frontier。"
    ],
    "model_adapter": {
      "cache": "request fingerprint",
      "enabled_when": "VNEXT_MODEL_PLANNING_ENABLED=true 且已配置 provider",
      "failure_behavior": "记录 planner.model_failed Event 后使用确定性 planner",
      "implementation": "06_runtime/src/runtime/model-planner.ts"
    },
    "planner_proposal": {
      "forbidden": [
        "自定义 Node kind、Capability ID 或执行代码",
        "指定未启用 Agent",
        "把 Candidate 直接写成 EvidenceFact、Claim 或 Judgment",
        "绕过 Source Capture",
        "申请超过 Task 总预算的节点预算"
      ],
      "node_field_notes": {
        "frontier_ref": "指向本节点服务的 Research Problem Graph frontier。模型提案在 Problem Graph ID 尚未回传时使用 pending-problem-graph + compiler_boundary；确定性编译器必须 在物化前重绑为真实 problemGraphId / problemNodeId / evidenceRequirementRef。\n"
      },
      "node_fields": [
        "key",
        "kind",
        "title",
        "depends_on",
        "budget",
        "reason",
        "frontier_ref"
      ],
      "required": [
        "intent",
        "rationale",
        "nodes",
        "stop_conditions"
      ]
    },
    "principle": "先从 Intent、Scenario 与 Task motif 装配 Research Problem Graph，再由模型提出当前 frontier 的候选执行路径；确定性编译器负责边界，Runtime 只执行编译后的 TaskGraph。\n",
    "problem_graph_input": {
      "contract": "02_scenario_task/00_problem_graph/contract.yaml",
      "required_context": [
        "active_intent_refs",
        "active_scenario_refs",
        "active_task_motif_refs",
        "unresolved_or_invalidated_frontier",
        "reusable_resolved_subgraphs"
      ],
      "rules": [
        "一个请求可激活多个 Task motif",
        "等价 JudgmentUnit 与 EvidenceRequirement 应合并复用",
        "Planner 只为当前 frontier 提案，不复制整张问题图",
        "每个候选执行节点必须记录其服务的 frontier_ref"
      ]
    },
    "runtime_events": [
      "planner.model_completed",
      "planner.model_failed",
      "planner.compiled",
      "plan.proposed"
    ],
    "runtime_execution_projection": {
      "intent_values": [
        "full_research",
        "evidence_only",
        "update_judgment",
        "compose_only",
        "clarify"
      ],
      "rule": "该值域是 User Intent 与 Workflow Pattern 编译后的执行先验，不是新的用户意图分类。"
    },
    "schema_name": "research_planning_contract",
    "schema_version": "2.0.0",
    "status": "active"
  },
  "problemGraphContract": {
    "assembly_cycle": [
      "normalize_request_and_scope",
      "activate_one_or_more_task_motifs",
      "apply_scenario_constraints_and_conditional_affordances",
      "merge_equivalent_units_and_reusable_evidence_requirements",
      "select_unresolved_or_invalidated_frontier",
      "compile_frontier_to_execution_task_graph",
      "commit_authorized_results_and_provenance",
      "propagate_invalidation_and_replan_delta"
    ],
    "assembly_cycle_note": "以上是闭环职责，不是必须顺序执行一次的固定 Workflow；在新证据、范围变化、阻断解除 或判断改版时可从任一受影响 frontier 重新进入。\n",
    "catalog_inputs": {
      "planning_prior": "02_scenario_task/05_workflow_patterns",
      "role": "02_scenario_task/04_roles/roles.yaml",
      "scenario": "02_scenario_task/02_scenarios/types.yaml",
      "scenario_cards": "02_scenario_task/02_scenarios",
      "task_motifs": "02_scenario_task/03_tasks",
      "user_intent": "02_scenario_task/01_intents/types.yaml"
    },
    "frontier_policy": {
      "selectable_states": [
        "unresolved",
        "invalidated",
        "blocked_recheck"
      ],
      "selection_factors": [
        "expected_information_gain",
        "dependency_unlock_value",
        "decision_relevance",
        "evidence_availability",
        "budget_and_deadline"
      ],
      "skip_states": [
        "resolved_and_fresh",
        "out_of_scope"
      ],
      "stop_when": [
        "所有 required 判断单元均 resolved、blocked 或 explicit_indeterminate",
        "Task Contract completion_criteria 已满足",
        "继续扩展的预期信息增益低于预算或时间阈值"
      ]
    },
    "graph_boundaries": {
      "execution_task_graph": {
        "answers": "本次执行哪些节点、依赖、预算与检查点",
        "invariant": "每次编译结果必须为 DAG",
        "owner": "06_runtime"
      },
      "research_problem_graph": {
        "answers": "研究问题由哪些判断单元、竞争解释、证据缺口、阻断与汇总关系组成",
        "instance_owner": "06_runtime",
        "owner": "02_scenario_task/00_problem_graph",
        "semantic_type_authority": "01_semantic_knowledge/01_ontology/models"
      },
      "research_provenance_graph": {
        "answers": "正式研究结论为什么成立",
        "owner": "01_semantic_knowledge/03_knowledge_graph"
      }
    },
    "invariants": [
      "不把目录编号解释为执行顺序",
      "不要求 Scenario 与 Task 一对一",
      "不要求一个请求只选择一个 Task",
      "不把 motif edge 直接写成 Ontology relation",
      "不把语义依赖等同于 TaskNode.dependsOn",
      "不因两个节点同图出现而推断业务事实",
      "已解决且新鲜的子图优先复用，变更只重算受影响子图",
      "每个执行节点必须可回溯到一个 frontier need",
      "任何正式语义写入仍须经过 Ontology Action 与 authority gate"
    ],
    "motif_contract": {
      "edge_endpoint_rule": "from 与 to 必须引用当前 motif 的 root 或 judgment_unit_roles.id",
      "edge_fields": [
        "from",
        "to",
        "relation"
      ],
      "judgment_unit_role_fields": [
        "id",
        "purpose",
        "required"
      ],
      "relation_values": [
        "requires",
        "informs",
        "challenges",
        "invalidates",
        "aggregates",
        "reuses"
      ],
      "required_fields": [
        "root_question",
        "judgment_unit_roles",
        "edges",
        "competing_explanation_policy",
        "aggregation"
      ]
    },
    "motif_edge_types": {
      "aggregates": {
        "acyclic": true,
        "execution_projection": "synthesis_input",
        "meaning": "来源单元参与目标问题或复合判断汇总"
      },
      "challenges": {
        "acyclic": false,
        "execution_projection": "competing_evidence_frontier",
        "meaning": "来源单元或竞争解释对目标单元构成反证路径"
      },
      "informs": {
        "acyclic": false,
        "execution_projection": "context_or_replan_trigger",
        "meaning": "来源单元结果会改变目标单元，但不要求严格串行"
      },
      "invalidates": {
        "acyclic": false,
        "execution_projection": "downstream_invalidation",
        "meaning": "来源变化会使目标单元或其既有结果失效"
      },
      "requires": {
        "acyclic": true,
        "execution_projection": "may_create_dependency",
        "meaning": "目标单元在逻辑上必须等待来源单元解决或阻断"
      },
      "reuses": {
        "acyclic": false,
        "execution_projection": "artifact_or_context_reuse",
        "meaning": "不同 motif 共享同一已识别单元、证据要求或已确认制品"
      }
    },
    "ontology_relation_refs": [
      "caseAddressesQuestion",
      "questionDecomposesIntoUnit",
      "unitUsesScope",
      "unitHasHypothesis",
      "unitHasCompetingExplanation",
      "unitHasBlockingFactor",
      "judgmentUnitRequiresEvidence",
      "judgmentResolvesUnit"
    ],
    "purpose": "规定 User Intent、Scenario 与 Research Task Contract 如何组合成 Research Problem Graph， 并把未解决 frontier 增量编译为 Runtime Execution TaskGraph。它不重定义 Ontology 对象/关系，也不登记可执行 Node kind。\n",
    "runtime_mapping": {
      "compiler": "06_runtime/src/runtime/plan-compiler.ts",
      "invalidation_policy": "01_semantic_knowledge/03_knowledge_graph/contracts/trace_policy.yaml",
      "node_catalog": "06_runtime/src/runtime/node-catalog.ts",
      "ontology_types": "01_semantic_knowledge/01_ontology/models",
      "planner": "06_runtime/src/runtime/planner.ts",
      "planner_contract": "02_scenario_task/contracts/research_planning_contract.yaml"
    },
    "runtime_projection": {
      "frontier_state_values": [
        "proposed",
        "unresolved",
        "active",
        "resolved",
        "blocked",
        "indeterminate",
        "invalidated",
        "out_of_scope"
      ],
      "relation_values": [
        "requires",
        "informs",
        "challenges",
        "invalidates",
        "aggregates",
        "reuses"
      ]
    },
    "schema_name": "research_problem_graph_contract",
    "schema_version": "1.0.0",
    "semantic_node_refs": [
      "ResearchCase",
      "ResearchScope",
      "ResearchQuestion",
      "JudgmentUnit",
      "Hypothesis",
      "CompetingExplanation",
      "BlockingFactor",
      "EvidenceRequirement",
      "Judgment"
    ],
    "status": "active"
  },
  "reportGeneration": {
    "agent_and_skill_responsibilities": [
      "research-design Skill 在受治理目录值域内提出章节级方法路径、理由和退出条件；不能发明方法 ID。",
      "根据目标与语义上下文建议报告类型和可选章节。",
      "在确定性章节容器内组织事实、推断、观点、竞争解释和表达顺序。",
      "按受众和深度调整解释密度，不改变证据等级、置信边界或改判条件。",
      "在证据不足时生成缺口说明和下一步取证建议，而不是补写结论。"
    ],
    "deterministic_responsibilities": [
      "ReportSpec 枚举、强制章节、排序和去重。",
      "SourceSnapshot、EvidenceFact、正式 Judgment 与 ResearchDeliverable 生命周期门禁。",
      "正式 Claim 只能引用 verified SourceReference；未经研究员确认并由 ApproveJudgment 提交的 Judgment 不能形成正式 Claim。",
      "缺少公司财务、竞争、估值、行业结构或情景输入时，相关章节必须标记 limited，禁止用通用模型常识补齐。",
      "ResearchDeliverable 必须持久化 report_kind、audience、depth、report_spec_version 和 section_keys。",
      "报告编辑后必须重新运行引用与表达审计。",
      "每个专业章节必须绑定可解析的 MethodApplication；框架、取证与裁决方法 ID 必须来自受治理方法目录和路由合同。",
      "MethodApplication 的最低证据角色未覆盖时只能为 provisional 或 blocked；不得把选中方法等同于已经执行。",
      "正式 Judgment 必须引用至少一个 execution_status=executed 且 gate_status=passed 的裁决 MethodApplication。"
    ],
    "evidence_role_values": [
      "demand",
      "supply",
      "inventory",
      "price",
      "utilization",
      "competition",
      "business_model",
      "financial",
      "expectation",
      "valuation",
      "mechanism",
      "risk"
    ],
    "lifecycle": [
      "ReportSpec 随 Task 创建并冻结到当前运行。",
      "计划确认同时确认章节级方法蓝图；初始 MethodApplication 为 candidate。",
      "EvidenceFact 按角色绑定到 MethodApplication 后状态变为 bound；输入门失败则 blocked。",
      "裁决 Function 实际消费绑定输入后，核心 MethodApplication 才可进入 executed/passed，并写入 Judgment 引用。",
      "EvidenceFact 通过确定性晋级后，由研究员确认进入 Judgment。",
      "JudgmentProposal 只有经 judgment_confirmation 和 ApproveJudgment 后成为正式 Judgment。",
      "judgment_confirmation 不接受 Agent 初始占位版本；Artifact.created_by 必须为 researcher。",
      "已批准 Judgment 修订后，新版本再次执行 ApproveJudgment，旧正式 Judgment 必须通过 SupersedeJudgment 保留历史并退出当前状态。",
      "Composer 只从当前 Task 的正式 Artifact 和 ReportSpec 组合 Report。",
      "CreateResearchDeliverable 把报告规格与正式 Judgment 写入本体关系。",
      "citation-and-expression Verifier 通过后，ResearchDeliverable 才可 verified；发布另需 publish_confirmation。",
      "Runtime 必须把 verified_not_published 与 published 分开展示；节点完成或 Verifier 通过不得自动发布。",
      "publish_confirmation 通过后只能由 PublishDeliverable Action 原子更新 ResearchDeliverable 及其包含的正式 Judgment。",
      "拒绝或暂缓 publish_confirmation 时，ResearchDeliverable 保持 verified，Task 转为等待输入，不伪装为已发布。"
    ],
    "method_profiles": {
      "core_by_kind": {
        "company_research": {
          "adjudicationMethodId": "kb04:A08",
          "evidenceMethodId": "kb03:A06",
          "frameworkIds": [
            "BF-BM-01",
            "BF-EE-01"
          ],
          "judgmentType": "impact_realization",
          "rationale": "公司主判断必须落到经营、盈利或现金桥，而不是停在行业叙事。",
          "requiredEvidenceRoles": [
            "business_model",
            "financial"
          ]
        },
        "evidence_update": {
          "adjudicationMethodId": "kb04:A02",
          "evidenceMethodId": "kb03:A03",
          "frameworkIds": [
            "JF-TREND"
          ],
          "judgmentType": "trend_direction",
          "rationale": "证据更新只说明同口径事实的新增方向，不自动升级原判断。",
          "requiredEvidenceRoles": [
            "demand",
            "expectation"
          ]
        },
        "industry_research": {
          "adjudicationMethodId": "kb04:A03",
          "evidenceMethodId": "kb03:A03",
          "frameworkIds": [
            "BF-SD-01"
          ],
          "judgmentType": "cycle_phase",
          "rationale": "行业主判断用供需、价格和周期阶段形成可证伪结论。",
          "requiredEvidenceRoles": [
            "demand",
            "supply",
            "price"
          ]
        },
        "judgment_update": {
          "adjudicationMethodId": "kb04:A02",
          "evidenceMethodId": "kb03:A03",
          "frameworkIds": [
            "JF-TREND"
          ],
          "judgmentType": "trend_direction",
          "rationale": "改判必须说明相对旧版本的新增事实、方向和失效条件。",
          "requiredEvidenceRoles": [
            "demand",
            "expectation"
          ]
        },
        "thematic_research": {
          "adjudicationMethodId": "kb04:A06",
          "evidenceMethodId": "kb03:A04",
          "frameworkIds": [
            "BF-VT-01"
          ],
          "judgmentType": "transmission_path",
          "rationale": "主题主判断必须经过机制与路径验证，不能把共现当作传导。",
          "requiredEvidenceRoles": [
            "mechanism",
            "demand",
            "supply"
          ]
        }
      },
      "domain_extensions": {
        "semiconductor_cycle": {
          "appendFrameworkId": "IF-SC-01",
          "judgmentType": "cycle_phase",
          "match": [
            "半导体",
            "芯片",
            "存储",
            "DRAM",
            "NAND",
            "HBM",
            "封装",
            "晶圆"
          ]
        }
      },
      "sections": {
        "alternative_hypotheses": {
          "adjudicationMethodId": "kb04:A05",
          "evidenceMethodId": "kb03:A04",
          "frameworkIds": [
            "BF-VT-01"
          ],
          "judgmentType": "causal_attribution",
          "rationale": "枚举竞争解释并寻找能够区分解释的证据，而不是罗列同义原因。",
          "requiredEvidenceRoles": [
            "mechanism",
            "demand"
          ]
        },
        "business_model": {
          "adjudicationMethodId": "kb04:A01",
          "evidenceMethodId": "kb03:A02",
          "frameworkIds": [
            "BF-BM-01"
          ],
          "judgmentType": "state_measurement",
          "rationale": "先验证收入机制与单位经济，再讨论商业模式质量。",
          "requiredEvidenceRoles": [
            "business_model",
            "financial"
          ]
        },
        "competitive_landscape": {
          "adjudicationMethodId": "kb04:A07",
          "evidenceMethodId": "kb03:A05",
          "frameworkIds": [
            "BF-IC-01"
          ],
          "judgmentType": "object_differentiation",
          "rationale": "所有竞争对象必须使用统一产品、地域、期间和指标口径。",
          "requiredEvidenceRoles": [
            "competition",
            "financial"
          ]
        },
        "cycle_supply_demand": {
          "adjudicationMethodId": "kb04:A03",
          "evidenceMethodId": "kb03:A03",
          "frameworkIds": [
            "BF-SD-01"
          ],
          "judgmentType": "cycle_phase",
          "rationale": "以需求、有效供给和价格/库存时钟共同判断周期，禁止单指标定阶段。",
          "requiredEvidenceRoles": [
            "demand",
            "supply",
            "price"
          ]
        },
        "delta_since_prior": {
          "adjudicationMethodId": "kb04:A02",
          "evidenceMethodId": "kb03:A03",
          "frameworkIds": [
            "JF-TREND"
          ],
          "judgmentType": "trend_direction",
          "rationale": "只比较同口径、同范围且带版本时间戳的历史判断。",
          "requiredEvidenceRoles": [
            "expectation",
            "demand"
          ]
        },
        "financial_operating_analysis": {
          "adjudicationMethodId": "kb04:A08",
          "evidenceMethodId": "kb03:A06",
          "frameworkIds": [
            "BF-FQ-01",
            "BF-EE-01"
          ],
          "judgmentType": "impact_realization",
          "rationale": "把报表事实、正常化基线和经营到财务的桥接分开核验。",
          "requiredEvidenceRoles": [
            "financial",
            "business_model"
          ]
        },
        "industry_structure": {
          "adjudicationMethodId": "kb04:A01",
          "evidenceMethodId": "kb03:A02",
          "frameworkIds": [
            "BF-IC-01"
          ],
          "judgmentType": "state_measurement",
          "rationale": "先冻结可替代市场边界，再比较参与者、产能和利润池。",
          "requiredEvidenceRoles": [
            "competition",
            "supply"
          ]
        },
        "mechanism_chain": {
          "adjudicationMethodId": "kb04:A06",
          "evidenceMethodId": "kb03:A04",
          "frameworkIds": [
            "BF-VT-01"
          ],
          "judgmentType": "transmission_path",
          "rationale": "逐段验证起点、传导节点、吸收或放大机制与终点结果。",
          "requiredEvidenceRoles": [
            "mechanism",
            "demand",
            "supply"
          ]
        },
        "risks_change_conditions": {
          "adjudicationMethodId": "kb04:A08",
          "evidenceMethodId": "kb03:A06",
          "frameworkIds": [
            "BF-RS-01"
          ],
          "judgmentType": "impact_realization",
          "rationale": "风险必须写成可观察触发、暴露、缓冲和恢复路径。",
          "requiredEvidenceRoles": [
            "risk"
          ]
        },
        "scenario_analysis": {
          "adjudicationMethodId": "kb04:A08",
          "evidenceMethodId": "kb03:A06",
          "frameworkIds": [
            "BF-RS-01",
            "BF-FS-01"
          ],
          "judgmentType": "impact_realization",
          "rationale": "情景必须绑定可观察触发条件、经营/财务变量和退出条件。",
          "requiredEvidenceRoles": [
            "risk",
            "financial",
            "expectation"
          ]
        },
        "valuation_scenarios": {
          "adjudicationMethodId": "kb04:A08",
          "evidenceMethodId": "kb03:A07",
          "frameworkIds": [
            "BF-EE-01",
            "BF-FS-01",
            "BF-EG-01",
            "BF-VA-01"
          ],
          "judgmentType": "valuation_impact",
          "rationale": "估值只能承接已通过的盈利桥、预测基线和事前预期，不能从主题判断直接跳到目标价。",
          "requiredEvidenceRoles": [
            "financial",
            "expectation",
            "valuation"
          ]
        }
      }
    },
    "personalization_boundary": {
      "allowed": [
        "audience",
        "depth",
        "optional_sections",
        "custom_instructions",
        "ordering_within_allowed_contract",
        "wording",
        "presentation"
      ],
      "forbidden": [
        "remove_evidence_analysis",
        "remove_risks_change_conditions",
        "remove_source_appendix",
        "invent_claim",
        "weaken_source_gate",
        "bypass_judgment_approval",
        "bypass_publish_approval"
      ]
    },
    "purpose": "把用户交付需求转换为受专业纪律约束的 ReportSpec 和 ResearchDeliverable， 允许受众、深度、可选章节与表达方式个性化，但不允许个性化绕过证据、判断、风险、来源和审计。",
    "report_spec": {
      "audiences": [
        "portfolio_manager",
        "investment_committee",
        "research_analyst",
        "client"
      ],
      "base_required_sections": [
        "executive_summary",
        "research_scope",
        "core_judgments",
        "evidence_analysis",
        "risks_change_conditions",
        "source_appendix"
      ],
      "depths": [
        "brief",
        "standard",
        "deep"
      ],
      "kind_inference": {
        "company_research": [
          "公司",
          "企业",
          "个股",
          "标的",
          "财务",
          "估值"
        ],
        "evidence_update": [
          "只补",
          "证据更新",
          "补充来源"
        ],
        "fallback": "thematic_research",
        "industry_research": [
          "行业",
          "产业",
          "供需",
          "周期",
          "竞争格局"
        ],
        "judgment_update": [
          "更新判断",
          "重新判断",
          "改判"
        ]
      },
      "kind_required_sections": {
        "company_research": [
          "business_model",
          "financial_operating_analysis",
          "competitive_landscape",
          "valuation_scenarios"
        ],
        "evidence_update": [
          "delta_since_prior"
        ],
        "industry_research": [
          "industry_structure",
          "cycle_supply_demand",
          "competitive_landscape"
        ],
        "judgment_update": [
          "delta_since_prior",
          "alternative_hypotheses"
        ],
        "thematic_research": [
          "mechanism_chain",
          "scenario_analysis",
          "alternative_hypotheses"
        ]
      },
      "kinds": [
        "company_research",
        "industry_research",
        "thematic_research",
        "evidence_update",
        "judgment_update"
      ],
      "language": [
        "zh-CN"
      ],
      "required": [
        "kind",
        "audience",
        "depth",
        "language",
        "sections"
      ],
      "version": "1.0.0"
    },
    "researcher_controls": [
      "研究问题与希望支持的决策",
      "报告类型、主要读者、深度与额外固定章节",
      "交付偏好和表达要求",
      "证据确认、Judgment 修改与批准、报告摘要修改、最终发布",
      "初始 JudgmentProposal 只是占位提案；必须在判断卡中保存研究员版本后，批准动作才可用"
    ],
    "runtime_mapping": {
      "approval_ui": "06_runtime/app/components/company-case-workspace.tsx",
      "composer": "06_runtime/src/reporting/report-composer.ts",
      "deliverable_action": "01_semantic_knowledge/01_ontology/kinetics/action_types.yaml#CreateResearchDeliverable",
      "intake_ui": "06_runtime/app/components/company-research-home.tsx",
      "judgment_commit": "06_runtime/src/runtime/kernel.ts#commitApprovedJudgment",
      "method_router": "06_runtime/src/research/method-router.ts",
      "normalization": "06_runtime/src/reporting/report-spec.ts",
      "ontology_object": "01_semantic_knowledge/01_ontology/models/operational.yaml#ResearchDeliverable",
      "publication_commit": "06_runtime/src/runtime/kernel.ts#commitApprovedPublication",
      "report_ui": "06_runtime/app/components/company-case-workspace.tsx",
      "spec_types": "06_runtime/src/contracts.ts"
    },
    "schema_name": "professional_report_generation_contract",
    "schema_version": "2.0.0",
    "section_statuses": {
      "limited": "章节必须保留，但证据或方法输入不足；正文必须说明缺口",
      "not_applicable": "经报告类型和范围规则确认不适用",
      "ready": "具备与该章节匹配的正式制品或已核验证据"
    },
    "status": "active",
    "verification": {
      "tests": [
        "06_runtime/tests/report-spec.test.ts",
        "06_runtime/tests/method-router.test.ts",
        "06_runtime/tests/report-composer.test.ts",
        "06_runtime/tests/kernel.test.ts",
        "06_runtime/tests/ontology-actions.test.ts"
      ]
    }
  },
  "roles": [
    {
      "description": "本次研究目标与方向的责任拥有者。 负责提出研究意图、提供必要上下文，并对关键判断和研究方向进行审阅与调整。\n",
      "eligible_actor_types": [
        "human"
      ],
      "responsibilities": [
        "define_research_intent",
        "provide_context_and_constraints",
        "review_critical_judgments",
        "redirect_or_accept_research"
      ],
      "role_id": "research_owner"
    },
    {
      "description": "本次研究任务的组织与综合责任角色。 负责澄清研究问题、保持研究目标一致性、协调必要任务，并综合形成最终判断。\n",
      "eligible_actor_types": [
        "agent",
        "human"
      ],
      "responsibilities": [
        "clarify_and_frame_problem",
        "maintain_research_alignment",
        "coordinate_required_tasks",
        "maintain_problem_graph_coherence",
        "select_and_replan_frontiers",
        "synthesize_research_judgment"
      ],
      "role_id": "research_lead"
    },
    {
      "description": "被委派的证据切片执行角色。只负责来源发现、获取、核验与 evidence_package， 不形成或批准正式 Judgment。\n",
      "eligible_actor_types": [
        "agent",
        "human"
      ],
      "responsibilities": [
        "execute_evidence_slice",
        "preserve_source_provenance",
        "report_evidence_gaps"
      ],
      "role_id": "evidence_investigator"
    },
    {
      "description": "被委派的财务模型责任角色。负责规范化财务、模型、估值分析和模型审计， 但不批准 Judgment、评级或发布。\n",
      "eligible_actor_types": [
        "agent",
        "human"
      ],
      "responsibilities": [
        "normalize_financials",
        "build_or_update_financial_model",
        "perform_model_audit",
        "prepare_valuation_analysis"
      ],
      "role_id": "financial_modeler"
    },
    {
      "description": "隔离的独立复核角色。只读取允许披露的制品范围，输出 review， 不得静默改写生产制品。\n",
      "eligible_actor_types": [
        "agent",
        "human"
      ],
      "responsibilities": [
        "inspect_provenance_and_permissions",
        "inspect_model_and_time_boundaries",
        "inspect_counterevidence_and_narrative_bias",
        "issue_review_only"
      ],
      "role_id": "independent_reviewer"
    }
  ],
  "scenarioTypes": {
    "CompanyResearch": {
      "aliases": [
        "个股研究"
      ],
      "completion_conditions": [
        "critical_units_resolved_or_blocked"
      ],
      "definition": "围绕公司经营状态、竞争位置和影响实现开展的研究场景。",
      "entry_conditions": [
        "company_identity_resolved",
        "scope_frozen"
      ],
      "id": "CompanyResearch",
      "invalidation_conditions": [
        "company_identity_changed",
        "critical_evidence_invalidated"
      ],
      "judgment_requirements": {
        "profile": "standard_company_judgment"
      },
      "label_en": "Company Research",
      "label_zh": "公司研究",
      "scope_dimensions": [
        "object",
        "geography",
        "product",
        "metric",
        "time"
      ],
      "semantic_requirements": {
        "profile": "company_research"
      },
      "task_affordances": [
        {
          "activate_when": [
            "company_proposition_present"
          ],
          "contributes": "公司命题与经营传导主图",
          "mode": "primary",
          "task_ref": "company_analysis"
        },
        {
          "activate_when": [
            "first_coverage_or_structured_fundamental_request"
          ],
          "contributes": "首次覆盖、模型、估值与命题复核主图",
          "mode": "conditional",
          "task_ref": "company_coverage"
        },
        {
          "activate_when": [
            "periodic_report_or_earnings_release_present"
          ],
          "contributes": "业绩、模型修订与命题影响分支",
          "mode": "conditional",
          "task_ref": "earnings_update"
        },
        {
          "activate_when": [
            "existing_thesis_requires_review"
          ],
          "contributes": "命题支柱、反证与失效条件分支",
          "mode": "conditional",
          "task_ref": "thesis_review"
        },
        {
          "activate_when": [
            "specific_material_event_present"
          ],
          "contributes": "事件冲击分支",
          "mode": "conditional",
          "task_ref": "event_impact"
        },
        {
          "activate_when": [
            "upstream_or_downstream_dependency_is_decision_relevant"
          ],
          "contributes": "依赖与瓶颈分支",
          "mode": "conditional",
          "task_ref": "value_chain_analysis"
        },
        {
          "activate_when": [
            "technology_route_changes_company_thesis"
          ],
          "contributes": "技术可行性与替代分支",
          "mode": "conditional",
          "task_ref": "technology_route_analysis"
        }
      ],
      "update_triggers": [
        "new_filing",
        "material_event",
        "key_metric_update"
      ]
    },
    "EventImpactResearch": {
      "aliases": [
        "事件点评"
      ],
      "completion_conditions": [
        "direct_and_indirect_impacts_separated"
      ],
      "definition": "围绕已发生事件的影响对象、传导路径、时间滞后和边界开展的研究场景。",
      "entry_conditions": [
        "event_fact_verified"
      ],
      "id": "EventImpactResearch",
      "invalidation_conditions": [
        "event_retracted_or_scope_revised"
      ],
      "judgment_requirements": {
        "profile": "standard_event_impact_judgment"
      },
      "label_en": "Event Impact Research",
      "label_zh": "事件影响研究",
      "scope_dimensions": [
        "event",
        "object",
        "geography",
        "value_chain",
        "time"
      ],
      "semantic_requirements": {
        "profile": "event_impact_research"
      },
      "task_affordances": [
        {
          "activate_when": [
            "event_fact_verified"
          ],
          "contributes": "直接与间接影响主图",
          "mode": "primary",
          "task_ref": "event_impact"
        },
        {
          "activate_when": [
            "impact_propagates_across_dependencies"
          ],
          "contributes": "跨节点传导子图",
          "mode": "supporting",
          "task_ref": "value_chain_analysis"
        },
        {
          "activate_when": [
            "company_exposure_or_realization_matters"
          ],
          "contributes": "公司影响兑现分支",
          "mode": "conditional",
          "task_ref": "company_analysis"
        },
        {
          "activate_when": [
            "event_may_change_cycle_state"
          ],
          "contributes": "周期状态更新分支",
          "mode": "conditional",
          "task_ref": "cycle_judgment"
        }
      ],
      "update_triggers": [
        "implementation_detail",
        "enforcement_change",
        "company_response"
      ]
    },
    "IndustryResearch": {
      "aliases": [
        "产业研究"
      ],
      "completion_conditions": [
        "main_and_competing_paths_discriminated"
      ],
      "definition": "围绕行业供需、竞争、周期和结构变化开展的研究场景。",
      "entry_conditions": [
        "industry_boundary_resolved",
        "time_basis_frozen"
      ],
      "id": "IndustryResearch",
      "invalidation_conditions": [
        "classification_boundary_changed",
        "critical_snapshot_invalidated"
      ],
      "judgment_requirements": {
        "profile": "standard_industry_judgment"
      },
      "label_en": "Industry Research",
      "label_zh": "行业研究",
      "scope_dimensions": [
        "industry",
        "geography",
        "value_chain",
        "metric",
        "time"
      ],
      "semantic_requirements": {
        "profile": "industry_research"
      },
      "task_affordances": [
        {
          "activate_when": [
            "cycle_or_supply_demand_question_present"
          ],
          "contributes": "周期状态与拐点主图",
          "mode": "primary",
          "task_ref": "cycle_judgment"
        },
        {
          "activate_when": [
            "bottleneck_or_transmission_matters"
          ],
          "contributes": "结构瓶颈与传导子图",
          "mode": "supporting",
          "task_ref": "value_chain_analysis"
        },
        {
          "activate_when": [
            "event_explains_material_state_change"
          ],
          "contributes": "事件归因分支",
          "mode": "conditional",
          "task_ref": "event_impact"
        },
        {
          "activate_when": [
            "technology_substitution_changes_industry_structure"
          ],
          "contributes": "技术替代分支",
          "mode": "conditional",
          "task_ref": "technology_route_analysis"
        }
      ],
      "update_triggers": [
        "supply_update",
        "demand_update",
        "price_update",
        "inventory_update"
      ]
    },
    "TechnologyRouteResearch": {
      "aliases": [
        "技术比较"
      ],
      "completion_conditions": [
        "performance_and_commercialization_constraints_assessed"
      ],
      "definition": "围绕技术能力、成熟度、替代性和商业化约束开展的研究场景。",
      "entry_conditions": [
        "technology_boundary_resolved"
      ],
      "id": "TechnologyRouteResearch",
      "invalidation_conditions": [
        "technology_definition_changed"
      ],
      "judgment_requirements": {
        "profile": "standard_technology_route_judgment"
      },
      "label_en": "Technology Route Research",
      "label_zh": "技术路线研究",
      "scope_dimensions": [
        "technology",
        "product",
        "application",
        "metric",
        "time"
      ],
      "semantic_requirements": {
        "profile": "technology_route_research"
      },
      "task_affordances": [
        {
          "activate_when": [
            "technology_boundary_resolved"
          ],
          "contributes": "成熟度、替代性与商业化主图",
          "mode": "primary",
          "task_ref": "technology_route_analysis"
        },
        {
          "activate_when": [
            "supply_chain_limits_scale_up"
          ],
          "contributes": "量产瓶颈子图",
          "mode": "supporting",
          "task_ref": "value_chain_analysis"
        },
        {
          "activate_when": [
            "validation_or_policy_event_changes_route"
          ],
          "contributes": "事件更新分支",
          "mode": "conditional",
          "task_ref": "event_impact"
        },
        {
          "activate_when": [
            "company_execution_differentiates_route_outcome"
          ],
          "contributes": "公司兑现分支",
          "mode": "conditional",
          "task_ref": "company_analysis"
        }
      ],
      "update_triggers": [
        "validation_result",
        "mass_production_event",
        "performance_update"
      ]
    },
    "ValueChainResearch": {
      "aliases": [
        "供应链研究"
      ],
      "completion_conditions": [
        "transmission_nodes_and_blockers_assessed"
      ],
      "definition": "围绕上下游依赖、传导与瓶颈开展的研究场景。",
      "entry_conditions": [
        "path_endpoints_resolved"
      ],
      "id": "ValueChainResearch",
      "invalidation_conditions": [
        "key_dependency_changed"
      ],
      "judgment_requirements": {
        "profile": "standard_value_chain_judgment"
      },
      "label_en": "Value Chain Research",
      "label_zh": "产业链研究",
      "scope_dimensions": [
        "value_chain",
        "object",
        "product",
        "geography",
        "time"
      ],
      "semantic_requirements": {
        "profile": "value_chain_research"
      },
      "task_affordances": [
        {
          "activate_when": [
            "path_endpoints_resolved"
          ],
          "contributes": "结构、瓶颈与传导主图",
          "mode": "primary",
          "task_ref": "value_chain_analysis"
        },
        {
          "activate_when": [
            "specific_shock_changes_path"
          ],
          "contributes": "冲击传播分支",
          "mode": "conditional",
          "task_ref": "event_impact"
        },
        {
          "activate_when": [
            "technical_substitute_or_bottleneck_present"
          ],
          "contributes": "替代或技术瓶颈分支",
          "mode": "conditional",
          "task_ref": "technology_route_analysis"
        },
        {
          "activate_when": [
            "company_level_realization_is_decision_relevant"
          ],
          "contributes": "公司兑现分支",
          "mode": "conditional",
          "task_ref": "company_analysis"
        }
      ],
      "update_triggers": [
        "supplier_change",
        "capacity_change",
        "restriction_event"
      ]
    }
  },
  "schemaName": "runtime_domain_catalog_projection",
  "schemaVersion": "2.0.0",
  "semanticProfiles": {
    "authority": "01_semantic_knowledge/01_ontology",
    "description": "研究场景所需的语义/判断类型清单（由 Scenario Type 引用 profile id）。\n类型定义权威在 models/；本文件只组合引用，不重定义对象模型。\n",
    "judgment_profiles": {
      "standard_company_judgment": {
        "required_judgment_types": [
          "ResearchQuestion",
          "JudgmentUnit",
          "Hypothesis",
          "Signal",
          "Judgment",
          "RuleEvaluation"
        ]
      },
      "standard_event_impact_judgment": {
        "required_judgment_types": [
          "ResearchQuestion",
          "JudgmentUnit",
          "Hypothesis",
          "CompetingExplanation",
          "Judgment"
        ]
      },
      "standard_industry_judgment": {
        "required_judgment_types": [
          "ResearchQuestion",
          "JudgmentUnit",
          "CompetingExplanation",
          "Hypothesis",
          "Signal",
          "Judgment"
        ]
      },
      "standard_technology_route_judgment": {
        "required_judgment_types": [
          "JudgmentUnit",
          "CompetingExplanation",
          "Signal",
          "Judgment"
        ]
      },
      "standard_value_chain_judgment": {
        "required_judgment_types": [
          "JudgmentUnit",
          "Hypothesis",
          "Signal",
          "BlockingFactor",
          "Judgment"
        ]
      }
    },
    "schema_name": "research_requirement_profiles",
    "schema_version": "1.0.0",
    "semantic_profiles": {
      "company_research": {
        "required_evidence_types": [
          "SourceDocument",
          "EvidenceRequirement",
          "EvidenceFact",
          "EvidenceAssessment",
          "EvidenceBasket"
        ],
        "required_financial_types": [
          "FinancialObservation",
          "Forecast",
          "ForecastAssumption",
          "ValuationAssessment"
        ],
        "required_object_types": [
          "Company",
          "FinancialInstrument",
          "Product",
          "Industry",
          "Metric",
          "ResearchScope"
        ],
        "required_operational_types": [
          "ResearchCase",
          "ResearchDeliverable"
        ],
        "required_relation_types": [
          "belongsTo",
          "produces",
          "competesWith",
          "dependsOn",
          "represents"
        ],
        "required_state_types": [
          "StateVariable",
          "Observation",
          "Event",
          "StateSnapshot"
        ],
        "semantic_contract": "contracts/company_fundamental_semantics.yaml"
      },
      "event_impact_research": {
        "required_evidence_types": [
          "SourceDocument",
          "EvidenceClaim",
          "EvidenceFact",
          "EvidenceAssessment"
        ],
        "required_object_types": [
          "Company",
          "Product",
          "Region",
          "ResearchScope"
        ],
        "required_relation_types": [
          "dependsOn",
          "supplies",
          "belongsTo"
        ],
        "required_state_types": [
          "Event",
          "StateVariable",
          "Observation"
        ]
      },
      "industry_research": {
        "required_evidence_types": [
          "EvidenceRequirement",
          "EvidenceFact",
          "EvidenceAssessment",
          "EvidenceBasket"
        ],
        "required_object_types": [
          "Industry",
          "ValueChainSegment",
          "Product",
          "Metric",
          "ResearchScope"
        ],
        "required_relation_types": [
          "belongsTo",
          "contains",
          "competesWith",
          "dependsOn"
        ],
        "required_state_types": [
          "StateVariable",
          "Observation",
          "Event",
          "StateSnapshot"
        ]
      },
      "technology_route_research": {
        "required_evidence_types": [
          "SourceDocument",
          "EvidenceFact",
          "EvidenceAssessment"
        ],
        "required_object_types": [
          "Technology",
          "Product",
          "Metric",
          "ResearchScope"
        ],
        "required_relation_types": [
          "belongsTo",
          "competesWith",
          "dependsOn"
        ],
        "required_state_types": [
          "StateVariable",
          "Observation",
          "Event"
        ]
      },
      "value_chain_research": {
        "required_evidence_types": [
          "EvidenceFact",
          "EvidenceAssessment",
          "EvidenceBasket"
        ],
        "required_object_types": [
          "Company",
          "Product",
          "ValueChainSegment",
          "ResearchScope"
        ],
        "required_relation_types": [
          "supplies",
          "suppliedBy",
          "dependsOn",
          "belongsTo"
        ],
        "required_state_types": [
          "StateVariable",
          "Event"
        ]
      }
    },
    "status": "active"
  },
  "sourceFingerprints": {
    "01_semantic_knowledge/01_ontology/contracts/company_fundamental_semantics.yaml": "sha256:3b14db90ef4a93932cfa1f85be4b4bbf486ee631f1c6522dd46f72c5aa7030b1",
    "01_semantic_knowledge/01_ontology/research_requirement_profiles.yaml": "sha256:ab8b454e5fb3b224b1cbfcd7c51e9f810d89bccb30cbf0da65a0da59b527a98e",
    "01_semantic_knowledge/02_dictionary/02_aliases.yaml": "sha256:fe608ab03371579f72ea30fe3dbfe2645aa53deece99ac60b57f991a54170be2",
    "01_semantic_knowledge/02_dictionary/04_ambiguity_rules.yaml": "sha256:c032dd333919e2ae867bd62f8dba64f40cc7876daf37dbb3770209388ce6c499",
    "01_semantic_knowledge/02_dictionary/05_deprecated_terms.yaml": "sha256:8a2a95e9bdecb2380565c3d91725ce21f9b8ae2994218c460270b92692412fb6",
    "01_semantic_knowledge/03_knowledge_graph/contracts/trace_policy.yaml": "sha256:8f010145c475ef8b047407100fed7362018d96dcb5af6a0dec1df1bb0c4ae2fe",
    "02_scenario_task/00_problem_graph/contract.yaml": "sha256:69bc4bfe9f3e22999255ba4b11195c5908f2c8a3664424bc8b0264e110e42691",
    "02_scenario_task/01_intents/types.yaml": "sha256:407359fe66d35927110741eb28768b4683d4a86839091f0b58aaf42c0c0e3ddb",
    "02_scenario_task/02_scenarios/types.yaml": "sha256:55c9945a0113295a948b6ceac597d054abf5be2b5712d4200a80653c425840d5",
    "02_scenario_task/03_tasks/company_analysis.yaml": "sha256:943a4be9b53253001d01dfbd15deb3da88c545108bbb43bb61ec37781c46631e",
    "02_scenario_task/03_tasks/company_coverage.yaml": "sha256:5e793be9ba6682f18b7e36646f78285925eeb8b7799bd6f4f5600a63fdbbf994",
    "02_scenario_task/03_tasks/cycle_judgment.yaml": "sha256:c4f25acfe5d21c65d9331eab7c79dc4225490cb24d22b37c3032fb250ed358a5",
    "02_scenario_task/03_tasks/earnings_update.yaml": "sha256:caab75859147d8d11521f37cd86891720b4058c29524240a1dff9e0bbf55fdb9",
    "02_scenario_task/03_tasks/event_impact.yaml": "sha256:33fc55b113431e473baf7a1b6db13c9aee10cdea26508c2561954202f754da64",
    "02_scenario_task/03_tasks/registry.yaml": "sha256:074ca56b4e480330aabff021342046605e8429cb401cfed7337b35bd2e112d25",
    "02_scenario_task/03_tasks/technology_route_analysis.yaml": "sha256:cebb0e01ef065e8bf9cba957c04c699e394f0dd634e9bd83d2c1ff37d0425bc5",
    "02_scenario_task/03_tasks/thesis_review.yaml": "sha256:cef09c33368c87bdb92e888b86d132a6bbe85cad08e5dbad77fce8de26d1d664",
    "02_scenario_task/03_tasks/value_chain_analysis.yaml": "sha256:880647fa6b1f8e039d280868735253672170d70f71e909d94be4e324c80acc70",
    "02_scenario_task/04_roles/roles.yaml": "sha256:a65bf2097b998c5678831380a07db0ba3fb2e59fd5e358cf3d5be91297f614cd",
    "02_scenario_task/05_workflow_patterns/deep_research.yaml": "sha256:dc3a58a193b05981a81ed39445b75517ba4f1d3bc62c79e05eb7b5fd2338bcab",
    "02_scenario_task/05_workflow_patterns/evidence_only.yaml": "sha256:97ff0dcdf3263c91cf3c758d9d62e7eadced8c5314f5a0963a2d89efe8e0aa27",
    "02_scenario_task/05_workflow_patterns/quick_research.yaml": "sha256:ef0153cd36dc5448718b708e143d3db606394f38bbe10571736e4d674da87af3",
    "02_scenario_task/05_workflow_patterns/registry.yaml": "sha256:d04e31d75ef7bd05a25ba4eb5fbf98dfac4c0d32fc6b038f39a99f91062c33d1",
    "02_scenario_task/contracts/judgment_reasoning_commit_contract.yaml": "sha256:269d03a1b00a57f53e151c76368a2d23304c0c32fc84f8125c3c011657ee3900",
    "02_scenario_task/contracts/report_generation_contract.yaml": "sha256:65bb4e32fb85ad122ca838cbc6265b5eabf6228a3ce4bdcd1f58c555eafa0310",
    "02_scenario_task/contracts/research_planning_contract.yaml": "sha256:1ff44b36407738700aff30a432102d2d7a4e4765d2dd504e5782754809d33005",
    "03_agent_capability/01_agents/registry.yaml": "sha256:79b065025409ad0289d889ba44bb2a8cefc9488a89fe36303479822366ae82c1",
    "03_agent_capability/02_skills/company_fundamental_research/SKILL.md": "sha256:1379932f50965c0d26429fb4d2bce488e01ae609f34b5358d5c22e5b7d78dc3b",
    "03_agent_capability/02_skills/earnings_update/SKILL.md": "sha256:e1415fe9ff72a5985009c5ada36e2994f8a4ea2ad1c13f7de4b901b94d091dc5",
    "03_agent_capability/02_skills/evidence_research/SKILL.md": "sha256:5d87f2386884fb8c08494325e62c5b13f8201b4c322dfbb9a224ba7761a188f1",
    "03_agent_capability/02_skills/financial_modeling/SKILL.md": "sha256:6e4a535299d43d5c58008d981c3859e00eb2aff83bff8ca0fcef9258d4c04140",
    "03_agent_capability/02_skills/independent_research_review/SKILL.md": "sha256:0383c11b17828b5a3d2d2b6370515d25021cdb5554af73a40966a3ff8c35ac54",
    "03_agent_capability/02_skills/judgment_reasoning/SKILL.md": "sha256:7837512bea415be7361de203d6c0154eed690b75f207a87772c31f33ea01a066",
    "03_agent_capability/02_skills/registry.yaml": "sha256:c1f50f4184a007d4479f15253ba753f3cf62beae7fe9005f61d613e322608a5b",
    "03_agent_capability/02_skills/research_delivery/SKILL.md": "sha256:597e7ef17146223c78500bcefb84b9a72f812cc6afeeaf7327e424ec071e65d7",
    "03_agent_capability/02_skills/research_design/SKILL.md": "sha256:d02aa646d974759bff1944255e198304274b6a55910a83e99543372d175b7e5f",
    "03_agent_capability/02_skills/research_framing/SKILL.md": "sha256:675609c393f089cf2575d345d2602db283ce29d2c47f2e0c3cf87ab1827006fa",
    "03_agent_capability/02_skills/sector_cycle_research/SKILL.md": "sha256:12af78bb58fbc6d99805d10358d1596a6ce0a6ab49e5f2f26149b9ef4edf8401",
    "03_agent_capability/02_skills/thesis_monitoring/SKILL.md": "sha256:f945993bfcfff5a762f06972b6612f1934aaa2ac6c6fe23977e5a66e76ba80d8",
    "03_agent_capability/02_skills/valuation_analysis/SKILL.md": "sha256:085e0916a272d00996232c8bb5d04673ccefd77b563df8cc1bb770e12c435e6d",
    "03_agent_capability/03_tools/registry.yaml": "sha256:e6e3be061ade6b014a897b0797d6f2a4f91b38d4d00df7dca5d2a183180b47ca",
    "03_agent_capability/releases/current.json": "sha256:1e831ff736ef2810bbb51b646698926b35cfd460b1e2533581d349abdf6b96e1",
    "04_context_state/01_context/contract.yaml": "sha256:0235bf154457b9c11a391879abcab72186cfebd96f0aa447b5946005640d5f40",
    "04_context_state/02_state/contract.yaml": "sha256:084d3c39af954aad89caae5faae26d760a1c4c0e9b047db8fa8a93685c57bdfd",
    "04_context_state/02_state/event_catalog.yaml": "sha256:a840636bdbb2e32ae93923e600faa6256955be585bef48de15b1d6f430ac0021",
    "04_context_state/02_state/lifecycle_contract.yaml": "sha256:463c9e480dbe1a53abd840396610b14decc57d9d7c2523dca7e0298d963df2e6",
    "04_context_state/03_memory/contract.yaml": "sha256:c3110ea938d4d6aec4452c0bd46dd300f1338e2175bc95d30abc5f7bf1ab615f",
    "04_context_state/04_workspace/contract.yaml": "sha256:d242861e070bdc2269ff0f2693873c818e08e3948cd1135abebe34401bd7e746",
    "05_control_evaluation/01_rules/contracts/public_contract.yaml": "sha256:d5ccdbcd0d7a5315c54cdc85e8a1c191962b70cff27b051c106d2f3244015ed1",
    "05_control_evaluation/01_rules/knowledge_promotion/knowledge_learning_contract.yaml": "sha256:131593c0d80b02c9d5f5f4b75f8f66fce53c80b093d679deddcc580be489cdfb",
    "05_control_evaluation/01_rules/policies/artifact_editing_policy.yaml": "sha256:40876c32d32a67b438dd1da7d8bdadec86bc47e05e21fe8e4a342019b811c4ed",
    "05_control_evaluation/01_rules/policies/asset_authority_matrix.yaml": "sha256:e6711f672820e7b1749ef66090d617244dd80f9cbfcb1b6c058bf656b550906d",
    "05_control_evaluation/01_rules/policies/capability_activation_policy.yaml": "sha256:a8dd337e1d98d88b8fb2a414e4dc9e3f695c7b78206e9f9a3222ac9738e0a81a",
    "05_control_evaluation/01_rules/policies/evidence_sufficiency_policy.yaml": "sha256:4c2d49e8b34fc9f6622895552f12333bad42a2e165646070c32d8728d02eb862",
    "05_control_evaluation/01_rules/policies/judgment_method_routes.yaml": "sha256:81ac5e91d0ea93d8494c439ad88f35314cac1ad2cb780f666b81abf5f541efa3",
    "05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml": "sha256:638451ab48a7ae16429f7562695064d5ffae0b825d5efb0a5dc621e61844c292",
    "05_control_evaluation/03_permissions/permission_matrix.yaml": "sha256:547c90638478dff36f0f9f85d941109da4db6b688b1200c4cc3766c949aafcd2",
    "05_control_evaluation/05_evals/cases/a-share-fundamental-v1/catalog.yaml": "sha256:9d894767aac62da48bd69ae038ce58f4d57ba9113450681adb98908f4cf833b8",
    "05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json": "sha256:c4a3e4b9072ac9e37cce4eb1de6403546e66a194bb73c1e209bfc7d510810e0d",
    "05_control_evaluation/05_evals/fixtures/gold-tasks.json": "sha256:6db24d32e69bdec78962854f5ecc7f0eeb08978f1c41435134e0b4cdf41672d7",
    "05_control_evaluation/05_evals/fixtures/live-canary-cases.json": "sha256:e3ac9b2185d5c1f39e739b04db00b1d05a0cbc76476dff8411fda8057ebb6abd",
    "05_control_evaluation/05_evals/fixtures/research-value-fixtures.json": "sha256:113de3b1b42b31acfc4808f37e6f2ef1a76d7c062674e9b9390df5d3d75d5fd1",
    "05_control_evaluation/05_evals/protocols/report_quality_evaluation_contract.yaml": "sha256:28c21147acf3a02a18167426b70930836a281c530517b33184279093aaed6a6e",
    "05_control_evaluation/05_evals/registry.yaml": "sha256:cfb3dc90ea0ba71744a1496ea127f1ddc63803bda33eb427ef5e1a329c8849d3"
  },
  "tasks": {
    "company_analysis": {
      "capability_requirements": [
        "company_operating_reasoning",
        "financial_transmission_reasoning",
        "evidence_assessment"
      ],
      "completion_criteria": [
        "已形成明确或“暂不可判断”的公司命题结论",
        "关键驱动与传导已点明，而非罗列公司全貌",
        "关键判断均存在证据支撑或明确证据缺口",
        "已说明主要反证和改判条件"
      ],
      "composition_rule": "可作为 company_coverage、earnings_update 或行业研究中的公司兑现分支复用；不得自动扩张为首次覆盖。",
      "description": "围绕明确的公司经营或业绩命题，形成可验证的公司层判断； 不是对公司做无边界的全面尽调。\n",
      "expected_output": [
        "proposition",
        "key_drivers",
        "evidence_support_level",
        "performance_transmission",
        "confidence",
        "reversal_conditions"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "proposition_with_transmission_and_evidence_ceiling",
          "required_units": [
            "proposition_scope",
            "key_drivers",
            "evidence_support",
            "performance_transmission",
            "countercase_and_reversal"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "key_drivers",
            "performance_transmission"
          ]
        },
        "edges": [
          {
            "from": "proposition_scope",
            "relation": "requires",
            "to": "evidence_support"
          },
          {
            "from": "key_drivers",
            "relation": "informs",
            "to": "performance_transmission"
          },
          {
            "from": "evidence_support",
            "relation": "informs",
            "to": "performance_transmission"
          },
          {
            "from": "countercase_and_reversal",
            "relation": "challenges",
            "to": "proposition_scope"
          },
          {
            "from": "key_drivers",
            "relation": "aggregates",
            "to": "company_proposition_question"
          },
          {
            "from": "evidence_support",
            "relation": "aggregates",
            "to": "company_proposition_question"
          },
          {
            "from": "performance_transmission",
            "relation": "aggregates",
            "to": "company_proposition_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "proposition_scope",
            "purpose": "冻结公司命题与范围",
            "required": true
          },
          {
            "id": "key_drivers",
            "purpose": "判断关键经营或业绩驱动",
            "required": true
          },
          {
            "id": "evidence_support",
            "purpose": "判断证据支持程度与缺口",
            "required": true
          },
          {
            "id": "performance_transmission",
            "purpose": "判断从驱动到业绩的传导",
            "required": true
          },
          {
            "id": "countercase_and_reversal",
            "purpose": "登记反证与改判条件",
            "required": true
          }
        ],
        "root_question": "company_proposition_question"
      },
      "judgment_requirements": [
        "公司命题的明确表述与范围边界",
        "关键经营/业绩驱动变量",
        "证据对命题的支持程度与主要缺口",
        "从驱动到业绩的传导关系",
        "主要反证与改判条件"
      ],
      "name": "公司分析",
      "objective": "围绕明确的公司经营或业绩命题，判断其关键驱动、证据支持程度、 业绩传导路径及改判条件。\n",
      "runtime_projection": {
        "activation_terms": [
          "公司",
          "企业",
          "经营",
          "收入",
          "利润",
          "订单",
          "份额",
          "竞争位置"
        ],
        "default_when_no_match": true,
        "scenario_refs": [
          "CompanyResearch"
        ],
        "selection_priority": 10,
        "unit_judgment_types": {
          "countercase_and_reversal": "causal_attribution",
          "evidence_support": "state_measurement",
          "key_drivers": "causal_attribution",
          "performance_transmission": "transmission_path",
          "proposition_scope": "state_measurement"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "问题中心是特定公司的经营状态、订单、业绩或竞争位置",
          "已有或可形成明确命题（例如订单兑现、份额变化、利润弹性）",
          "需要评估证据是否足以支撑该命题"
        ],
        "excludes_when": [
          "要求对公司做无命题的“全面研究”",
          "核心是行业周期、技术路线或产业链结构，公司只是举例对象",
          "仅要求核实单一公告或单一财务读数"
        ]
      },
      "task_id": "company_analysis",
      "task_layer": "narrow_company_proposition",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true,
        "governed_outcomes": [
          "completed_supported",
          "completed_indeterminate",
          "stopped_insufficient_evidence",
          "blocked_permission",
          "blocked_missing_source",
          "blocked_policy"
        ]
      }
    },
    "company_coverage": {
      "capability_requirements": [
        "company_fundamental_research",
        "financial_modeling",
        "valuation_analysis",
        "thesis_monitoring",
        "independent_research_review"
      ],
      "completion_criteria": [
        "主 lens 与 counter-lens 已登记",
        "财务模型通过确定性审计，或明确阻断原因",
        "估值仅在模型审计通过后形成",
        "命题状态、反证、催化剂和失效条件已版本化"
      ],
      "description": "A 股半导体公司结构化基本面标杆任务；组合多个可复用判断单元，但不形成固定流水线。",
      "expected_output": [
        "research_plan",
        "research_problem_graph",
        "company_fundamental_input",
        "evidence_package",
        "normalized_financials",
        "financial_model",
        "valuation_analysis",
        "hypothesis_map",
        "judgment",
        "thesis_state",
        "review",
        "report"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "audited_model_countercase_and_delivery",
          "required_units": [
            "scope_and_lenses",
            "business_and_kpi",
            "financial_model_integrity",
            "valuation_boundary",
            "thesis_countercase",
            "independent_review",
            "report_and_sources"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "business_and_kpi",
            "valuation_boundary"
          ]
        },
        "edges": [
          {
            "from": "scope_and_lenses",
            "relation": "informs",
            "to": "business_and_kpi"
          },
          {
            "from": "scope_and_lenses",
            "relation": "informs",
            "to": "financial_model_integrity"
          },
          {
            "from": "business_and_kpi",
            "relation": "informs",
            "to": "financial_model_integrity"
          },
          {
            "from": "financial_model_integrity",
            "relation": "requires",
            "to": "valuation_boundary"
          },
          {
            "from": "thesis_countercase",
            "relation": "challenges",
            "to": "company_coverage_question"
          },
          {
            "from": "business_and_kpi",
            "relation": "informs",
            "to": "thesis_countercase"
          },
          {
            "from": "valuation_boundary",
            "relation": "informs",
            "to": "thesis_countercase"
          },
          {
            "from": "thesis_countercase",
            "relation": "requires",
            "to": "independent_review"
          },
          {
            "from": "independent_review",
            "relation": "requires",
            "to": "report_and_sources"
          },
          {
            "from": "report_and_sources",
            "relation": "aggregates",
            "to": "company_coverage_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "scope_and_lenses",
            "purpose": "冻结主体、范围、主 lens 与 counter lens",
            "required": true
          },
          {
            "id": "business_and_kpi",
            "purpose": "商业模式与关键经营变量",
            "required": true
          },
          {
            "id": "financial_model_integrity",
            "purpose": "财务标准化与模型完整性",
            "required": true
          },
          {
            "id": "valuation_boundary",
            "purpose": "估值假设、范围与敏感性",
            "required": true
          },
          {
            "id": "thesis_countercase",
            "purpose": "命题、反证与失效条件",
            "required": true
          },
          {
            "id": "independent_review",
            "purpose": "独立检查来源、时间、模型、反证与表达边界",
            "required": true
          },
          {
            "id": "report_and_sources",
            "purpose": "形成带来源附录和审计状态的公司研究报告",
            "required": true
          }
        ],
        "root_question": "company_coverage_question"
      },
      "input_semantics": {
        "authority": "01_semantic_knowledge/01_ontology/contracts/company_fundamental_semantics.yaml",
        "required": [
          "company_code",
          "company_name",
          "as_of",
          "research_question",
          "primary_lens",
          "counter_lens",
          "report_spec",
          "source_policy"
        ]
      },
      "invalidation_contract": [
        {
          "change": "scope_or_as_of",
          "invalidates": [
            "scope_and_lenses",
            "business_and_kpi",
            "financial_model_integrity",
            "valuation_boundary",
            "thesis_countercase",
            "independent_review",
            "report_and_sources"
          ]
        },
        {
          "change": "source_or_evidence",
          "invalidates": [
            "business_and_kpi",
            "financial_model_integrity",
            "thesis_countercase",
            "independent_review",
            "report_and_sources"
          ]
        },
        {
          "change": "financial_model",
          "invalidates": [
            "valuation_boundary",
            "thesis_countercase",
            "independent_review",
            "report_and_sources"
          ]
        },
        {
          "change": "judgment",
          "invalidates": [
            "thesis_countercase",
            "independent_review",
            "report_and_sources"
          ]
        },
        {
          "change": "report",
          "invalidates": [
            "independent_review",
            "report_and_sources"
          ]
        }
      ],
      "judgment_requirements": [
        "商业模式、关键 KPI 与竞争优势",
        "历史财务标准化、驱动式预测和模型审计",
        "估值方法、假设、区间与敏感性",
        "主 research lens、counter-lens、反证与失效条件"
      ],
      "name": "公司首次覆盖",
      "objective": "在明确的研究边界内形成公司商业模式、驱动、财务模型、估值分析和投资命题的可审计输入； 不自动产生评级、目标价、仓位或交易指令。\n",
      "required_unit_contracts": {
        "business_and_kpi": {
          "artifact": "company_fundamental_input",
          "blocked_outcomes": [
            "stopped_insufficient_evidence",
            "blocked_missing_source"
          ],
          "complete_when": "商业模式、关键 KPI、竞争位置和财务桥均有证据或显式缺口",
          "evidence_roles": [
            "support",
            "counter",
            "boundary"
          ],
          "inputs": [
            "Company",
            "Product",
            "Metric",
            "StateVariable"
          ]
        },
        "financial_model_integrity": {
          "artifacts": [
            "normalized_financials",
            "financial_model"
          ],
          "blocked_outcomes": [
            "stopped_insufficient_evidence",
            "blocked_permission",
            "blocked_policy"
          ],
          "complete_when": "历史标准化与确定性模型审计通过或形成可定位阻断",
          "evidence_roles": [
            "support",
            "boundary"
          ],
          "inputs": [
            "FinancialObservation",
            "ForecastAssumption"
          ]
        },
        "independent_review": {
          "artifact": "review",
          "blocked_outcomes": [
            "blocked_policy"
          ],
          "complete_when": "权限、截止日、单位、模型、反证和表达边界均已检查",
          "evidence_roles": [
            "boundary"
          ],
          "inputs": [
            "artifact_manifest",
            "source_refs",
            "review_scope"
          ]
        },
        "report_and_sources": {
          "artifact": "report",
          "blocked_outcomes": [
            "blocked_policy",
            "completed_indeterminate"
          ],
          "complete_when": "强制章节、来源附录和确定性审计完成；发布仍需独立确认",
          "evidence_roles": [
            "support",
            "counter",
            "boundary"
          ],
          "inputs": [
            "approved_judgment",
            "verified_artifacts",
            "report_spec"
          ]
        },
        "scope_and_lenses": {
          "artifact": "research_plan",
          "blocked_outcomes": [
            "blocked_policy"
          ],
          "complete_when": "主体、截止日、研究问题、主 lens 与 counter lens 均冻结",
          "evidence_roles": [
            "boundary"
          ],
          "inputs": [
            "Company",
            "FinancialInstrument",
            "ResearchScope"
          ]
        },
        "thesis_countercase": {
          "artifacts": [
            "hypothesis_map",
            "judgment",
            "thesis_state"
          ],
          "blocked_outcomes": [
            "completed_indeterminate",
            "stopped_insufficient_evidence"
          ],
          "complete_when": "命题、最强反证、催化剂、失效条件与改判信号均版本化",
          "evidence_roles": [
            "support",
            "counter"
          ],
          "inputs": [
            "Hypothesis",
            "CompetingExplanation",
            "EvidenceFact"
          ]
        },
        "valuation_boundary": {
          "artifact": "valuation_analysis",
          "blocked_outcomes": [
            "blocked_policy",
            "stopped_insufficient_evidence"
          ],
          "complete_when": "估值方法、asOf、输入、区间和敏感性可审计，或模型失败导致明确阻断",
          "evidence_roles": [
            "support",
            "counter",
            "boundary"
          ],
          "inputs": [
            "financial_model",
            "ValuationAssessment"
          ]
        }
      },
      "runtime_projection": {
        "activation_terms": [
          "首次覆盖",
          "首覆",
          "公司覆盖",
          "结构化基本面",
          "结构化公司基本面",
          "深度公司研究"
        ],
        "scenario_refs": [
          "CompanyResearch"
        ],
        "selection_priority": 100,
        "suppresses_when_selected": [
          "company_analysis"
        ],
        "unit_judgment_types": {
          "business_and_kpi": "causal_attribution",
          "financial_model_integrity": "impact_realization",
          "independent_review": "state_measurement",
          "report_and_sources": "impact_realization",
          "scope_and_lenses": "state_measurement",
          "thesis_countercase": "causal_attribution",
          "valuation_boundary": "valuation_impact"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "用户要求 A 股公司首次覆盖或结构化基本面研究",
          "需要模型与估值作为判断输入"
        ],
        "excludes_when": [
          "仅核实单一公告或读数",
          "无公司主体和时间范围",
          "需要投资指令"
        ]
      },
      "task_id": "company_coverage",
      "task_layer": "composite_company_fundamental",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true,
        "blocked_output_behavior": "输出证据缺口或阻断，不推断缺失财务值",
        "governed_outcomes": [
          "completed_supported",
          "completed_indeterminate",
          "stopped_insufficient_evidence",
          "blocked_permission",
          "blocked_missing_source",
          "blocked_policy",
          "failed_technical",
          "cancelled_by_user"
        ]
      }
    },
    "cycle_judgment": {
      "capability_requirements": [
        "temporal_state_reasoning",
        "evidence_assessment",
        "counterfactual_reasoning"
      ],
      "completion_criteria": [
        "已形成明确或“暂不可判断”的周期结论",
        "关键判断均存在证据支撑或明确证据缺口",
        "已说明主要反证和改判条件"
      ],
      "description": "对行业或子行业在给定时间窗内的景气周期状态形成可验证判断。",
      "expected_output": [
        "cycle_state",
        "direction",
        "key_drivers",
        "turning_point_assessment",
        "confidence",
        "reversal_conditions"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "required_units_with_explicit_block",
          "required_units": [
            "cycle_state",
            "direction",
            "drivers_and_constraints",
            "turning_point",
            "reversal_conditions"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "cycle_state",
            "turning_point"
          ]
        },
        "edges": [
          {
            "from": "drivers_and_constraints",
            "relation": "informs",
            "to": "cycle_state"
          },
          {
            "from": "drivers_and_constraints",
            "relation": "informs",
            "to": "direction"
          },
          {
            "from": "cycle_state",
            "relation": "requires",
            "to": "turning_point"
          },
          {
            "from": "direction",
            "relation": "requires",
            "to": "turning_point"
          },
          {
            "from": "reversal_conditions",
            "relation": "challenges",
            "to": "cycle_state"
          },
          {
            "from": "cycle_state",
            "relation": "aggregates",
            "to": "cycle_question"
          },
          {
            "from": "direction",
            "relation": "aggregates",
            "to": "cycle_question"
          },
          {
            "from": "turning_point",
            "relation": "aggregates",
            "to": "cycle_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "cycle_state",
            "purpose": "判断当前周期位置",
            "required": true
          },
          {
            "id": "direction",
            "purpose": "判断周期变化方向",
            "required": true
          },
          {
            "id": "drivers_and_constraints",
            "purpose": "区分驱动变量与约束变量",
            "required": true
          },
          {
            "id": "turning_point",
            "purpose": "判断拐点及确认条件",
            "required": true
          },
          {
            "id": "reversal_conditions",
            "purpose": "登记反证与改判条件",
            "required": true
          }
        ],
        "root_question": "cycle_question"
      },
      "judgment_requirements": [
        "当前周期状态（上行 / 下行 / 筑底 / 见顶 / 拐点区间 / 暂不可判断）",
        "周期变化方向",
        "主要驱动变量及约束变量",
        "是否存在拐点及其确认条件",
        "主要反证与改判条件"
      ],
      "name": "周期判断",
      "objective": "判断给定时间窗内行业或子行业所处周期状态、变化方向及潜在拐点， 并明确判断依据与改判条件。\n",
      "runtime_projection": {
        "activation_terms": [
          "行业",
          "景气",
          "周期",
          "库存",
          "价格",
          "供需",
          "拐点"
        ],
        "scenario_refs": [
          "IndustryResearch"
        ],
        "unit_judgment_types": {
          "cycle_state": "cycle_phase",
          "direction": "trend_direction",
          "drivers_and_constraints": "causal_attribution",
          "reversal_conditions": "state_measurement",
          "turning_point": "cycle_phase"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "问题核心涉及行业景气状态、趋势或拐点",
          "需要综合多个周期变量判断共同变化",
          "需要回答“处于什么阶段 / 是否接近拐点”"
        ],
        "excludes_when": [
          "仅要求核实单一事实或单一指标读数",
          "仅要求描述某一事件本身而不涉及周期状态",
          "核心是公司经营命题而非行业周期命题"
        ]
      },
      "task_id": "cycle_judgment",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true
      }
    },
    "earnings_update": {
      "capability_requirements": [
        "earnings_update",
        "financial_modeling",
        "thesis_monitoring",
        "independent_research_review"
      ],
      "completion_criteria": [
        "每项比较对象均有口径与时间边界",
        "无 vintage 的一致预期不产生超/低预期结论",
        "一次性项目、稀释股本和模型修订已披露或明确缺失"
      ],
      "expected_output": [
        "normalized_financials",
        "financial_model",
        "thesis_state",
        "review"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "actual_to_model_to_thesis",
          "required_units": [
            "actual_quality",
            "comparison_boundary",
            "model_and_thesis_impact"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "model_and_thesis_impact"
          ]
        },
        "edges": [
          {
            "from": "actual_quality",
            "relation": "requires",
            "to": "comparison_boundary"
          },
          {
            "from": "comparison_boundary",
            "relation": "informs",
            "to": "model_and_thesis_impact"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "actual_quality",
            "purpose": "实际值与一次性项目",
            "required": true
          },
          {
            "id": "comparison_boundary",
            "purpose": "内部前值、指引和一致预期比较边界",
            "required": true
          },
          {
            "id": "model_and_thesis_impact",
            "purpose": "模型与命题影响",
            "required": true
          }
        ],
        "root_question": "earnings_update_question"
      },
      "judgment_requirements": [
        "实际值、会计口径、一次性项目与可比基础",
        "与内部前值和公司指引的差异",
        "一致预期的授权、asOf 与 vintage；缺失时明确阻断 beat/miss",
        "模型修订和命题支柱影响"
      ],
      "name": "业绩更新",
      "objective": "将实际业绩与内部前值、公司指引及有授权 vintage 的一致预期分别比较， 解释差异、更新模型并登记命题影响。\n",
      "runtime_projection": {
        "activation_terms": [
          "业绩更新",
          "财报",
          "业绩快报",
          "业绩预告",
          "季报",
          "年报",
          "超预期",
          "低预期"
        ],
        "scenario_refs": [
          "CompanyResearch"
        ],
        "selection_priority": 120,
        "suppresses_when_selected": [
          "company_analysis",
          "thesis_review"
        ],
        "unit_judgment_types": {
          "actual_quality": "state_measurement",
          "comparison_boundary": "expectation_gap",
          "model_and_thesis_impact": "impact_realization"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "存在定期报告、业绩预告、业绩快报或正式业绩材料",
          "需要解释业绩变化与命题影响"
        ],
        "excludes_when": [
          "无报告期或披露主体",
          "只需要市场行情摘要"
        ]
      },
      "task_id": "earnings_update",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true,
        "consensus_without_vintage": "block_comparison"
      }
    },
    "event_impact": {
      "capability_requirements": [
        "causal_path_reasoning",
        "evidence_assessment",
        "counterfactual_reasoning"
      ],
      "completion_criteria": [
        "已形成明确或“暂不可判断”的影响结论",
        "直接影响与间接影响已分开表述",
        "关键判断均存在证据支撑或明确证据缺口",
        "已说明边界与改判条件"
      ],
      "description": "对已发生或正在发生的事件，判断其影响方向、强度、路径与时滞。",
      "expected_output": [
        "event_scope",
        "direct_impacts",
        "indirect_paths",
        "intensity_and_lag",
        "confidence",
        "reversal_conditions"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "direct_path_required_optional_indirect",
          "required_units": [
            "event_scope",
            "direct_impact",
            "intensity_and_lag",
            "boundary_and_reversal"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "direct_impact",
            "indirect_paths"
          ]
        },
        "edges": [
          {
            "from": "event_scope",
            "relation": "requires",
            "to": "direct_impact"
          },
          {
            "from": "direct_impact",
            "relation": "informs",
            "to": "indirect_paths"
          },
          {
            "from": "direct_impact",
            "relation": "informs",
            "to": "intensity_and_lag"
          },
          {
            "from": "indirect_paths",
            "relation": "informs",
            "to": "intensity_and_lag"
          },
          {
            "from": "boundary_and_reversal",
            "relation": "challenges",
            "to": "direct_impact"
          },
          {
            "from": "direct_impact",
            "relation": "aggregates",
            "to": "event_impact_question"
          },
          {
            "from": "indirect_paths",
            "relation": "aggregates",
            "to": "event_impact_question"
          },
          {
            "from": "intensity_and_lag",
            "relation": "aggregates",
            "to": "event_impact_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "event_scope",
            "purpose": "核验事件事实与生效边界",
            "required": true
          },
          {
            "id": "direct_impact",
            "purpose": "判断直接影响对象与状态变量",
            "required": true
          },
          {
            "id": "indirect_paths",
            "purpose": "判断间接传导路径",
            "required": false
          },
          {
            "id": "intensity_and_lag",
            "purpose": "判断影响强度与时滞",
            "required": true
          },
          {
            "id": "boundary_and_reversal",
            "purpose": "登记边界、反证与改判触发",
            "required": true
          }
        ],
        "root_question": "event_impact_question"
      },
      "judgment_requirements": [
        "事件事实及其生效范围",
        "直接影响对象与受影响状态变量",
        "影响方向、相对强度与主要时滞",
        "间接传导路径（如有）及其不确定性",
        "边界条件、反证与改判触发"
      ],
      "name": "事件影响判断",
      "objective": "判断事件对对象状态变量及资产影响路径的方向、强度与时滞， 区分直接影响与间接影响，并明确边界与改判条件。\n",
      "runtime_projection": {
        "activation_terms": [
          "公告",
          "事件",
          "政策",
          "监管",
          "并购",
          "停产",
          "事故",
          "冲击",
          "影响"
        ],
        "scenario_refs": [
          "EventImpactResearch"
        ],
        "unit_judgment_types": {
          "boundary_and_reversal": "causal_attribution",
          "direct_impact": "impact_realization",
          "event_scope": "state_measurement",
          "indirect_paths": "transmission_path",
          "intensity_and_lag": "impact_realization"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "问题由具体事件触发，需要判断“影响什么、怎么影响”",
          "需要区分直接冲击、传导路径与时滞",
          "事件本身已可核实，重点在影响判断"
        ],
        "excludes_when": [
          "仅要求核实事件是否发生或复述事件内容",
          "核心是长期周期状态而非事件冲击路径",
          "没有可识别的事件对象或影响对象"
        ]
      },
      "task_id": "event_impact",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true
      }
    },
    "technology_route_analysis": {
      "capability_requirements": [
        "technology_maturity_reasoning",
        "comparative_assessment",
        "evidence_assessment"
      ],
      "completion_criteria": [
        "已形成明确或“暂不可判断”的技术路线结论",
        "成熟度、替代性与商业化约束均已覆盖或标明缺口",
        "已给出可证伪边界与改判条件"
      ],
      "description": "评估技术路线的成熟度、替代性与商业化约束，并给出可证伪边界。",
      "expected_output": [
        "technology_boundary",
        "maturity_stage",
        "substitution_assessment",
        "commercialization_constraints",
        "confidence",
        "falsification_conditions"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "comparative_route_with_commercialization_gate",
          "required_units": [
            "technology_boundary",
            "maturity_stage",
            "substitution_assessment",
            "commercialization_constraints",
            "falsification_conditions"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "substitution_assessment",
            "commercialization_constraints"
          ]
        },
        "edges": [
          {
            "from": "technology_boundary",
            "relation": "requires",
            "to": "maturity_stage"
          },
          {
            "from": "technology_boundary",
            "relation": "requires",
            "to": "substitution_assessment"
          },
          {
            "from": "maturity_stage",
            "relation": "informs",
            "to": "commercialization_constraints"
          },
          {
            "from": "commercialization_constraints",
            "relation": "informs",
            "to": "substitution_assessment"
          },
          {
            "from": "falsification_conditions",
            "relation": "challenges",
            "to": "substitution_assessment"
          },
          {
            "from": "maturity_stage",
            "relation": "aggregates",
            "to": "technology_route_question"
          },
          {
            "from": "substitution_assessment",
            "relation": "aggregates",
            "to": "technology_route_question"
          },
          {
            "from": "commercialization_constraints",
            "relation": "aggregates",
            "to": "technology_route_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "technology_boundary",
            "purpose": "冻结技术边界与比较对象",
            "required": true
          },
          {
            "id": "maturity_stage",
            "purpose": "判断成熟度阶段",
            "required": true
          },
          {
            "id": "substitution_assessment",
            "purpose": "判断相对替代路线优劣",
            "required": true
          },
          {
            "id": "commercialization_constraints",
            "purpose": "判断商业化与量产约束",
            "required": true
          },
          {
            "id": "falsification_conditions",
            "purpose": "登记证伪边界与改判条件",
            "required": true
          }
        ],
        "root_question": "technology_route_question"
      },
      "judgment_requirements": [
        "技术边界与比较对象",
        "成熟度所处阶段",
        "相对替代路线的优劣势",
        "商业化与量产约束",
        "证伪边界与改判条件"
      ],
      "name": "技术路线分析",
      "objective": "评估给定技术路线相对替代方案的成熟度、替代性与商业化约束， 明确可证伪边界与改判条件。\n",
      "runtime_projection": {
        "activation_terms": [
          "技术",
          "路线",
          "成熟度",
          "良率",
          "商业化",
          "替代",
          "硅光",
          "SiC",
          "碳化硅"
        ],
        "scenario_refs": [
          "TechnologyRouteResearch"
        ],
        "unit_judgment_types": {
          "commercialization_constraints": "causal_attribution",
          "falsification_conditions": "state_measurement",
          "maturity_stage": "cycle_phase",
          "substitution_assessment": "object_differentiation",
          "technology_boundary": "state_measurement"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "问题核心是技术能力、成熟度、替代进度或商业化可行性",
          "存在可比较的技术路线或替代路径",
          "需要判断“能不能用 / 能不能放量 / 受什么约束”"
        ],
        "excludes_when": [
          "仅要求解释技术原理而不形成判断",
          "核心是公司财务或行业周期，技术只是背景",
          "没有可识别的技术边界或比较对象"
        ]
      },
      "task_id": "technology_route_analysis",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true
      }
    },
    "thesis_review": {
      "capability_requirements": [
        "thesis_monitoring",
        "independent_research_review"
      ],
      "completion_criteria": [
        "新版本不覆盖历史版本",
        "每个 strengthen/weaken/block 信号有证据制品引用",
        "未达到改判门槛时明确维持或暂不可判断"
      ],
      "expected_output": [
        "thesis_state",
        "review"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "versioned_thesis_state",
          "required_units": [
            "pillar_status",
            "counterevidence",
            "catalyst_and_invalidation"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "pillar_status"
          ]
        },
        "edges": [
          {
            "from": "counterevidence",
            "relation": "challenges",
            "to": "pillar_status"
          },
          {
            "from": "catalyst_and_invalidation",
            "relation": "aggregates",
            "to": "thesis_review_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "pillar_status",
            "purpose": "命题支柱状态",
            "required": true
          },
          {
            "id": "counterevidence",
            "purpose": "反证和阻断项",
            "required": true
          },
          {
            "id": "catalyst_and_invalidation",
            "purpose": "催化剂与失效条件",
            "required": true
          }
        ],
        "root_question": "thesis_review_question"
      },
      "judgment_requirements": [
        "命题支柱及历史版本",
        "信号方向与证据引用",
        "反证与阻断项",
        "催化剂、失效条件和待补证据"
      ],
      "name": "投资命题复核",
      "objective": "基于已验证证据、模型和历史命题版本，判断哪些支柱被强化、削弱或阻断， 并登记催化剂、失效条件与待补证据。\n",
      "runtime_projection": {
        "activation_terms": [
          "命题复核",
          "命题跟踪",
          "投资逻辑跟踪",
          "thesis",
          "催化剂",
          "失效条件"
        ],
        "scenario_refs": [
          "CompanyResearch"
        ],
        "unit_judgment_types": {
          "catalyst_and_invalidation": "impact_realization",
          "counterevidence": "causal_attribution",
          "pillar_status": "state_measurement"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "已有 ResearchCase 或历史 thesis_state",
          "需要定期或事件后复核"
        ],
        "excludes_when": [
          "没有可识别的研究命题",
          "请求自动交易决策"
        ]
      },
      "task_id": "thesis_review",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true
      }
    },
    "value_chain_analysis": {
      "capability_requirements": [
        "structural_dependency_reasoning",
        "bottleneck_identification",
        "evidence_assessment"
      ],
      "completion_criteria": [
        "已形成明确或“暂不可判断”的结构/瓶颈/传导结论",
        "结构识别、瓶颈、传导与影响方向均已覆盖或标明缺口",
        "已说明主要反证和改判条件"
      ],
      "description": "识别上下游结构、瓶颈与传导关系，判断影响方向而非泛泛描述产业链。",
      "expected_output": [
        "structure_map",
        "bottlenecks",
        "transmission_paths",
        "impact_direction",
        "confidence",
        "reversal_conditions"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "structure_path_and_impact_required",
          "required_units": [
            "structure_map",
            "bottlenecks",
            "transmission_paths",
            "impact_direction",
            "reversal_conditions"
          ]
        },
        "competing_explanation_policy": {
          "minimum": 1,
          "required_for": [
            "bottlenecks",
            "transmission_paths",
            "impact_direction"
          ]
        },
        "edges": [
          {
            "from": "structure_map",
            "relation": "informs",
            "to": "bottlenecks"
          },
          {
            "from": "structure_map",
            "relation": "requires",
            "to": "transmission_paths"
          },
          {
            "from": "bottlenecks",
            "relation": "informs",
            "to": "transmission_paths"
          },
          {
            "from": "transmission_paths",
            "relation": "requires",
            "to": "impact_direction"
          },
          {
            "from": "reversal_conditions",
            "relation": "challenges",
            "to": "impact_direction"
          },
          {
            "from": "structure_map",
            "relation": "aggregates",
            "to": "value_chain_question"
          },
          {
            "from": "bottlenecks",
            "relation": "aggregates",
            "to": "value_chain_question"
          },
          {
            "from": "impact_direction",
            "relation": "aggregates",
            "to": "value_chain_question"
          }
        ],
        "judgment_unit_roles": [
          {
            "id": "structure_map",
            "purpose": "识别关键节点与依赖方向",
            "required": true
          },
          {
            "id": "bottlenecks",
            "purpose": "区分名义供给与有效供给并识别瓶颈",
            "required": true
          },
          {
            "id": "transmission_paths",
            "purpose": "判断冲击如何沿依赖网络传递",
            "required": true
          },
          {
            "id": "impact_direction",
            "purpose": "判断关键对象的影响方向",
            "required": true
          },
          {
            "id": "reversal_conditions",
            "purpose": "登记反证与改判条件",
            "required": true
          }
        ],
        "root_question": "value_chain_question"
      },
      "judgment_requirements": [
        "上下游结构识别（关键节点与依赖方向）",
        "瓶颈识别（名义供给 vs 有效供给）",
        "传导关系（冲击如何沿链传递）",
        "对关键对象的影响方向",
        "主要反证与改判条件"
      ],
      "name": "产业链分析",
      "objective": "刻画上下游依赖结构、瓶颈位置与传导关系，区分名义供给与有效供给， 并判断关键节点变化的影响方向与改判条件。\n",
      "runtime_projection": {
        "activation_terms": [
          "产业链",
          "价值链",
          "上游",
          "下游",
          "供应链",
          "瓶颈",
          "传导",
          "供给约束"
        ],
        "scenario_refs": [
          "IndustryResearch",
          "ValueChainResearch"
        ],
        "unit_judgment_types": {
          "bottlenecks": "causal_attribution",
          "impact_direction": "impact_realization",
          "reversal_conditions": "state_measurement",
          "structure_map": "state_measurement",
          "transmission_paths": "transmission_path"
        }
      },
      "schema_name": "research_task_contract",
      "schema_version": "3.0.0",
      "scope": {
        "applies_when": [
          "问题核心涉及上下游依赖、瓶颈、传导或供给约束",
          "需要区分结构位置与影响路径",
          "需要回答“卡在哪里 / 怎么传导 / 影响谁”"
        ],
        "excludes_when": [
          "仅要求列举产业链参与者名单",
          "核心是单一公司命题且不涉及上下游依赖",
          "仅要求描述单一事件而不涉及结构传导"
        ]
      },
      "task_id": "value_chain_analysis",
      "uncertainty_policy": {
        "allow_insufficient_evidence": true
      }
    }
  },
  "tracePolicy": {
    "description": "研究溯源图的下游失效传播方向合同。BFS、标记 stale、查找样例包等执行 属于 Runtime / Governance，不在本目录实现。\n",
    "downstream_invalidation": {
      "directions": {
        "assessmentEvaluatesFact": "reverse",
        "basketFulfillsRequirement": "reverse",
        "basketIncludesAssessment": "reverse",
        "claimCitesSnapshot": "reverse",
        "claimCitesSource": "reverse",
        "competingExplanationForUnit": "reverse",
        "factDerivedFromClaim": "reverse",
        "factSupportsSignal": "forward",
        "hypothesisEvaluatedBySignal": "reverse",
        "hypothesisForUnit": "reverse",
        "hypothesisSupportsJudgment": "forward",
        "judgmentBasedOnHypothesis": "reverse",
        "judgmentHasReasoningTrace": "forward",
        "judgmentHasRuleEvaluation": "reverse",
        "judgmentResolvesUnit": "reverse",
        "questionDecomposesIntoUnit": "forward",
        "reasoningTraceForJudgment": "reverse",
        "requirementForJudgmentUnit": "reverse",
        "ruleEvaluationForJudgment": "forward",
        "runtimeJudgmentUsesMethodApplication": "reverse",
        "runtimeMethodApplicationTargets": "reverse",
        "scopeIncludesObject": "forward",
        "signalEvaluatesHypothesis": "forward",
        "signalGroundedByFact": "reverse",
        "traceIncludesNode": "reverse",
        "unitHasHypothesis": "forward",
        "unitUsesScope": "forward"
      },
      "meaning": "forward：边 source → target 为影响方向； reverse：边 target → source 为影响方向（沿边反向传播失效）。\n"
    },
    "execution_boundary": {
      "contract_here": [
        "downstream relation direction table"
      ],
      "runtime_or_governance": [
        "traceReachableDownstream BFS",
        "markReachableDownstreamStale",
        "defaultExamplePackages / workspace 样例发现"
      ]
    },
    "schema_name": "knowledge_graph_trace_policy",
    "schema_version": "1.0.0",
    "status": "active"
  },
  "workflowPatterns": {
    "deep_research": {
      "description": "Deep Research 规划先验——通常需要广取证、竞争解释与可重规划；不是固定 01→05 流水线。",
      "graph_prior": {
        "convergence": "required_units_resolved_blocked_or_explicit_indeterminate",
        "expand_competing_branches": true,
        "frontier_strategy": "information_gain_and_dependency_unlock",
        "max_parallel_frontiers": "bounded_by_runtime_budget",
        "motif_activation": "multi_task",
        "replan_on": [
          "new_evidence",
          "scope_change",
          "contradiction",
          "invalidation"
        ],
        "reuse_resolved_subgraphs": true
      },
      "human_gates": [
        "judgment_confirmation",
        "publish_confirmation"
      ],
      "intent": "deep_research",
      "notes": [
        "禁止把本 pattern 解释为必须按 Stage 01–05 顺序执行。",
        "Runtime 只执行 node-catalog 中满足前置条件的节点。"
      ],
      "planning_hints": {
        "allow_parallel_evidence": true,
        "allow_replanning": true,
        "prefer_broad_evidence": true,
        "require_competing_explanation": true
      },
      "recommended_capabilities": [
        "framing",
        "structure",
        "evidence",
        "judgment",
        "synthesis"
      ],
      "runtime_selection": {
        "routes": [
          {
            "report_depths": [
              "deep"
            ],
            "runtime_intent": "full_research"
          }
        ]
      },
      "status": "active_pattern",
      "workflow_id": "deep_research"
    },
    "evidence_only": {
      "description": "仅取证/核验先验——对齐 Runtime ResearchIntent=evidence_only；不是用户级 Research Task。",
      "graph_prior": {
        "convergence": "requested_evidence_requirements_resolved_or_blocked",
        "expand_competing_branches": false,
        "frontier_strategy": "requested_evidence_gap",
        "max_parallel_frontiers": "bounded_by_runtime_budget",
        "motif_activation": "reuse_existing_only",
        "replan_on": [
          "requested_evidence_invalidated"
        ],
        "reuse_resolved_subgraphs": true
      },
      "human_gates": [
        "evidence_confirmation"
      ],
      "intent": "evidence_only",
      "maps_to_runtime_intent": "evidence_only",
      "notes": [
        "对应 node 链由 planner/plan-compiler 展开；本文件只提供 pattern prior。"
      ],
      "planning_hints": {
        "allow_parallel_evidence": true,
        "allow_replanning": false,
        "prefer_broad_evidence": false,
        "require_competing_explanation": false
      },
      "recommended_capabilities": [
        "evidence"
      ],
      "runtime_selection": {
        "routes": [
          {
            "report_depths": [
              "brief",
              "standard",
              "deep"
            ],
            "runtime_intent": "evidence_only"
          }
        ]
      },
      "status": "active_pattern",
      "workflow_id": "evidence_only"
    },
    "quick_research": {
      "description": "轻量研究先验——范围更窄、证据波次更少，仍要求竞争解释或明确降级。",
      "graph_prior": {
        "convergence": "core_required_units_resolved_or_explicit_indeterminate",
        "expand_competing_branches": "only_for_core_judgment",
        "frontier_strategy": "dependency_unlock_then_decision_relevance",
        "max_parallel_frontiers": 1,
        "motif_activation": "minimum_decision_relevant_set",
        "replan_on": [
          "decisive_contradiction",
          "critical_invalidation"
        ],
        "reuse_resolved_subgraphs": true
      },
      "human_gates": [
        "judgment_confirmation",
        "publish_confirmation"
      ],
      "intent": "quick_research",
      "planning_hints": {
        "allow_parallel_evidence": false,
        "allow_replanning": true,
        "prefer_broad_evidence": false,
        "require_competing_explanation": true
      },
      "recommended_capabilities": [
        "framing",
        "evidence",
        "judgment",
        "synthesis"
      ],
      "runtime_selection": {
        "routes": [
          {
            "report_depths": [
              "brief",
              "standard"
            ],
            "runtime_intent": "full_research"
          },
          {
            "report_depths": [
              "brief",
              "standard",
              "deep"
            ],
            "runtime_intent": "update_judgment"
          },
          {
            "report_depths": [
              "brief",
              "standard",
              "deep"
            ],
            "runtime_intent": "compose_only"
          }
        ]
      },
      "status": "active_pattern",
      "workflow_id": "quick_research"
    }
  }
} as const;
export const TASK_CATALOG = DOMAIN_CATALOG.tasks;
export const CAPABILITY_CATALOG = DOMAIN_CATALOG.capabilities;
export const STATE_MACHINE_CATALOG = DOMAIN_CATALOG.contextState.lifecycle;
export const GOVERNANCE_POLICY_CATALOG = DOMAIN_CATALOG.governance;
export const EVAL_CATALOG = DOMAIN_CATALOG.evaluation;
