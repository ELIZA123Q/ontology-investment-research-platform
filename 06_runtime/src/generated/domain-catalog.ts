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
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "research-framing",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "research-design",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "evidence-research",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "judgment-reasoning",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
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
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "semantic.search",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "source.discover",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "source.capture",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "source.query",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
          "executionScopes": [
            "production",
            "evaluation"
          ],
          "id": "artifact.publish",
          "lifecycle": "active",
          "version": "1.0.0"
        },
        {
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
        "implementation": "06_runtime/src/runtime/store.ts",
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
      "schema_version": "1.0.0",
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
      ]
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
  "governance": {
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
  "schemaVersion": "1.0.0",
  "sourceFingerprints": {
    "01_semantic_knowledge/02_dictionary/02_aliases.yaml": "sha256:fe608ab03371579f72ea30fe3dbfe2645aa53deece99ac60b57f991a54170be2",
    "01_semantic_knowledge/02_dictionary/04_ambiguity_rules.yaml": "sha256:c032dd333919e2ae867bd62f8dba64f40cc7876daf37dbb3770209388ce6c499",
    "01_semantic_knowledge/02_dictionary/05_deprecated_terms.yaml": "sha256:8a2a95e9bdecb2380565c3d91725ce21f9b8ae2994218c460270b92692412fb6",
    "01_semantic_knowledge/03_knowledge_graph/contracts/trace_policy.yaml": "sha256:8f010145c475ef8b047407100fed7362018d96dcb5af6a0dec1df1bb0c4ae2fe",
    "02_scenario_task/01_intents/types.yaml": "sha256:407359fe66d35927110741eb28768b4683d4a86839091f0b58aaf42c0c0e3ddb",
    "02_scenario_task/02_scenarios/types.yaml": "sha256:55c9945a0113295a948b6ceac597d054abf5be2b5712d4200a80653c425840d5",
    "02_scenario_task/03_tasks/company_analysis.yaml": "sha256:3a987942f1a5fe3a84efe887c67734d84a86c2fd69e1a236f2030a08fcb18cc3",
    "02_scenario_task/03_tasks/company_coverage.yaml": "sha256:6738488f2d6762320042494e296e9501b0cfcb6adaed210fec354689630f3b18",
    "02_scenario_task/03_tasks/cycle_judgment.yaml": "sha256:c4f25acfe5d21c65d9331eab7c79dc4225490cb24d22b37c3032fb250ed358a5",
    "02_scenario_task/03_tasks/earnings_update.yaml": "sha256:6f7ffed99bb877f82fd97c9125137d873437753cf3ef8f67355f690a469891ac",
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
    "03_agent_capability/01_agents/registry.yaml": "sha256:79b065025409ad0289d889ba44bb2a8cefc9488a89fe36303479822366ae82c1",
    "03_agent_capability/02_skills/registry.yaml": "sha256:c1f50f4184a007d4479f15253ba753f3cf62beae7fe9005f61d613e322608a5b",
    "03_agent_capability/03_tools/registry.yaml": "sha256:e6e3be061ade6b014a897b0797d6f2a4f91b38d4d00df7dca5d2a183180b47ca",
    "03_agent_capability/releases/current.json": "sha256:42074ed368de04a471fe3c67c1d6fe2c1dc3ff9d092d3fdd5ef672435cfb540e",
    "04_context_state/01_context/contract.yaml": "sha256:0235bf154457b9c11a391879abcab72186cfebd96f0aa447b5946005640d5f40",
    "04_context_state/02_state/contract.yaml": "sha256:4eff4f4da2ba33cf1a4723753d654e5c01c4c601049bceb407bbfc4eaebae1a8",
    "04_context_state/03_memory/contract.yaml": "sha256:c3110ea938d4d6aec4452c0bd46dd300f1338e2175bc95d30abc5f7bf1ab615f",
    "04_context_state/04_workspace/contract.yaml": "sha256:d242861e070bdc2269ff0f2693873c818e08e3948cd1135abebe34401bd7e746",
    "05_control_evaluation/01_rules/policies/judgment_method_routes.yaml": "sha256:81ac5e91d0ea93d8494c439ad88f35314cac1ad2cb780f666b81abf5f541efa3",
    "05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml": "sha256:638451ab48a7ae16429f7562695064d5ffae0b825d5efb0a5dc621e61844c292",
    "05_control_evaluation/03_permissions/permission_matrix.yaml": "sha256:547c90638478dff36f0f9f85d941109da4db6b688b1200c4cc3766c949aafcd2"
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
      "uncertainty_policy": {
        "allow_insufficient_evidence": true
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
      "expected_output": [
        "company_fundamental_input",
        "normalized_financials",
        "financial_model",
        "valuation_analysis",
        "thesis_state",
        "review"
      ],
      "graph_motif": {
        "aggregation": {
          "allow_partial_with_gaps": true,
          "mode": "audited_model_and_countercase",
          "required_units": [
            "business_and_kpi",
            "financial_model_integrity",
            "valuation_boundary",
            "thesis_countercase"
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
          }
        ],
        "judgment_unit_roles": [
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
          }
        ],
        "root_question": "company_coverage_question"
      },
      "judgment_requirements": [
        "商业模式、关键 KPI 与竞争优势",
        "历史财务标准化、驱动式预测和模型审计",
        "估值方法、假设、区间与敏感性",
        "主 research lens、counter-lens、反证与失效条件"
      ],
      "name": "公司首次覆盖",
      "objective": "在明确的研究边界内形成公司商业模式、驱动、财务模型、估值分析和投资命题的可审计输入； 不自动产生评级、目标价、仓位或交易指令。\n",
      "runtime_projection": {
        "activation_terms": [
          "首次覆盖",
          "首覆",
          "公司覆盖",
          "结构化基本面",
          "深度公司研究"
        ],
        "scenario_refs": [
          "CompanyResearch"
        ],
        "unit_judgment_types": {
          "business_and_kpi": "causal_attribution",
          "financial_model_integrity": "impact_realization",
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
      "uncertainty_policy": {
        "allow_insufficient_evidence": true,
        "blocked_output_behavior": "输出证据缺口或阻断，不推断缺失财务值"
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
