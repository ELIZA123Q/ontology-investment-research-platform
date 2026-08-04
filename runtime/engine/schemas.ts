import { z } from "zod";
import {
  markdownSchema as markdown,
  nonEmptyStringSchema as nonEmptyString,
  qualityStatusSchema as qualityStatus,
  stageStatusSchema as stageStatus,
} from "./schema_primitives";
import {
  EVALUATION_CRITERIA,
  evaluationSchema,
  evaluationSubmissionSchema,
  independentReviewSchema,
} from "./schemas_review";
import { taskDefinitionSchema } from "./schemas_stage01";
import {
  ONTOLOGY_CONFIDENCE_LEVELS,
  ONTOLOGY_ENUMS,
  ONTOLOGY_JUDGMENT_LEVELS,
  ONTOLOGY_JUDGMENT_TYPES,
  ONTOLOGY_SOURCE_TIERS,
} from "./ontology_vocabulary.generated";

const ontologyGapScanStatus = z.enum(["no_gap", "minor_gap", "major_gap", "blocking_gap"]);
const judgmentType = z.enum(ONTOLOGY_JUDGMENT_TYPES);

export const methodApplicationSchema = z.object({
  application_id: z.string().regex(/^MA-[A-Z0-9_-]+$/),
  method_id: nonEmptyString,
  method_version: nonEmptyString,
  capability_type: z.enum(["judgment_structure", "evidence", "adjudication"]),
  target_question_refs: z.array(z.string()),
  target_judgment_unit_refs: z.array(z.string()).min(1),
  target_ontology_object_refs: z.array(z.string()),
  status: z.enum(["candidate", "selected", "executed", "rejected", "blocked", "degraded"]),
  precondition_checks: z.array(z.object({
    precondition_id: nonEmptyString,
    result: z.enum(["pass", "fail", "partial", "not_checked"]),
    evidence_refs: z.array(z.string()),
    reason: nonEmptyString,
  })),
  input_evidence_refs: z.array(z.string()),
  output_signal_refs: z.array(z.string()),
  output_judgment_refs: z.array(z.string()),
  execution_summary: z.string(),
  applicability_boundary: nonEmptyString,
  limitations: z.array(z.string()),
  counter_example_refs: z.array(z.string()),
  provenance: z.object({
    stage: z.enum(["stage_02", "stage_03", "stage_04"]),
    source_application_id: z.string().nullable(),
    actor: nonEmptyString,
    recorded_at: z.string().nullable(),
  }),
  alternatives: z.array(z.object({
    method_id: nonEmptyString,
    decision: nonEmptyString,
    reason: nonEmptyString,
  })),
});

export const judgmentStructureSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  research_scope: z.object({
    id: nonEmptyString,
    label: nonEmptyString,
    dimensions: z.record(z.string(), z.unknown()),
    // 本研究显式实例化的核心业务对象（公司/产品/产业等）。以前端「实体关系图」可见为前提，
    // 生成器必须把问题中点名的核心标的落入此处；平台会在规范化阶段兜底补齐。
    core_objects: z.array(z.object({
      id: nonEmptyString,
      type: nonEmptyString,
      name: nonEmptyString,
    })).optional().default([]),
  }),
  // 业务实体实例（Company / Product / Industry 等）。物质化阶段据此生成「实体关系图」节点；
  // 缺省由平台规范化层从 Stage01 core_object 与研究问题兜底实例化，根治历史产物实体图空白。
  ontology_instances: z.array(z.object({
    id: nonEmptyString,
    type: nonEmptyString,
    name: nonEmptyString,
    label: z.string().nullable().optional(),
    ticker: z.string().nullable().optional(),
    dimension: z.string().nullable().optional(),
    properties: z.record(z.string(), z.unknown()).nullable().optional(),
  })).optional().default([]),
  judgment_units: z.array(z.object({
    id: nonEmptyString,
    title: nonEmptyString,
    question: nonEmptyString,
    judgment_type: judgmentType,
    scope_ref: nonEmptyString,
    ontology_node_ids: z.array(z.string()),
    evidence_requirements: z.array(z.string()),
    // Public Contract 1.3 / 02 规范可选字段；缺省由投影或只读适配器补齐。
    candidate_claim: z.string().nullable().optional(),
    content_hash: z.string().nullable().optional(),
    priority_tier: z.enum(["critical", "important", "supporting", "optional"]).nullable().optional(),
    decision_weight: z.number().min(0).max(1).nullable().optional(),
    decision_role: z.enum(["primary", "supporting", "boundary", "watch"]).nullable().optional(),
  })).min(1),
  /**
   * 01 根问题到 02 原子判断的闭环合同。
   *
   * JudgmentUnit 只解决局部问题；没有本合同，02 即使拆得很细，也无法证明
   * 这些局部裁决最终能够回答 01。旧产物允许缺省，生成/确认门会补投影并校验。
   */
  task_answer_contract: z.object({
    root_question_ref: nonEmptyString,
    root_question: nonEmptyString,
    required_judgment_unit_ids: z.array(z.string()).min(1),
    synthesis_operator: z.enum(["all_required", "weighted", "conditional", "comparative", "custom"]),
    synthesis_rule: nonEmptyString,
    blocking_policy: nonEmptyString,
    hypothesis_coverage: z.array(z.object({
      hypothesis_ref: nonEmptyString,
      judgment_unit_ids: z.array(z.string()).min(1),
    })).default([]),
  }).nullable().optional(),
  variables: z.array(z.object({
    id: nonEmptyString,
    name: nonEmptyString,
    category: nonEmptyString,
    definition: nonEmptyString,
    variable_kind: nonEmptyString,
    anchors: z.array(z.string()).min(1),
    ontology_node_id: nonEmptyString,
    role: nonEmptyString,
    metric_ref: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    time_basis: z.string().nullable().optional(),
    object_scope: z.array(z.string()).nullable().optional(),
    geography: z.string().nullable().optional(),
    observation_period: z.string().nullable().optional(),
  })),
  paths: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    variable_ids: z.array(z.string()).min(1),
    judgment_unit_ids: z.array(z.string()).min(1),
  })),
  // optional 字段必须同时 nullable，以兼容 DeepSeek/OpenAI 严格函数 Schema
  //（所有 properties 均须 required；缺省用 null 表示）。保留 .optional() 以便兼容旧产物缺字段。
  questions: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString.nullable().optional(),
    question: nonEmptyString.nullable().optional(),
    scope_ref: z.string().nullable().optional(),
    failure_route: z.enum(ONTOLOGY_ENUMS["ResearchQuestion.failure_route"]).nullable().optional(),
  }).refine((item) => Boolean(item.statement || item.question), { message: "研究问题缺少 statement/question" })).default([]),
  evidence_requirements: z.array(z.object({
    id: nonEmptyString,
    requirement: nonEmptyString,
    evidence_role: z.enum(ONTOLOGY_ENUMS["EvidenceRequirement.evidence_role"]),
    minimum_independent_sources: z.number().int().nonnegative(),
    // Ontology 3.0: 一条 ER 只服务一个原子 JudgmentUnit。
    judgment_unit_ids: z.array(z.string()).min(1).max(1),
    source: z.enum(["unit_requirement", "counter_direction"]).nullable().optional(),
    source_ref: z.string().nullable().optional(),
    evidence_profile_refs: z.array(z.string()).nullable().optional(),
    evidence_recipe_ref: z.string().nullable().optional(),
    derivation_refs: z.object({
      judgment_unit_ref: z.string().nullable(),
      state_variable_refs: z.array(z.string()),
      path_refs: z.array(z.string()),
    }).nullable().optional(),
    no_profile_reason: z.string().nullable().optional(),
  })).default([]),
  counter_evidence_directions: z.array(z.preprocess(
    (value) => {
      if (typeof value === "string") {
        return { direction_id: "CD-COERCED", statement: value, judgment_unit_ids: [] };
      }
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return {
          direction_id: String(record.direction_id || record.id || "CD-COERCED"),
          statement: String(record.statement || ""),
          judgment_unit_ids: Array.isArray(record.judgment_unit_ids) ? record.judgment_unit_ids.map(String) : [],
        };
      }
      return value;
    },
    z.object({
      direction_id: nonEmptyString,
      statement: nonEmptyString,
      judgment_unit_ids: z.array(z.string()).default([]),
    }),
  )),
  competing_explanations: z.array(z.preprocess(
    (value) => {
      if (typeof value === "string") {
        const statement = value.trim();
        return {
          explanation_id: "CE-COERCED",
          statement,
          judgment_unit_ids: [],
          discriminating_evidence: statement
            ? [`需可区分「${statement}」与主判断路径的对照证据`]
            : ["需可区分主判断路径与该竞争解释的对照证据"],
        };
      }
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const statement = String(record.statement || "").trim();
        let discriminating = Array.isArray(record.discriminating_evidence)
          ? record.discriminating_evidence.map(String).map((item) => item.trim()).filter(Boolean)
          : [];
        if (!discriminating.length && Array.isArray(record.discriminating_evidence_requirements)) {
          discriminating = record.discriminating_evidence_requirements.map(String).map((item) => item.trim()).filter(Boolean);
        }
        if (!discriminating.length) {
          discriminating = statement
            ? [`需可区分「${statement}」与主判断路径的对照证据`]
            : ["需可区分主判断路径与该竞争解释的对照证据"];
        }
        return {
          explanation_id: String(record.explanation_id || record.id || "CE-COERCED"),
          statement: String(record.statement || ""),
          judgment_unit_ids: Array.isArray(record.judgment_unit_ids) ? record.judgment_unit_ids.map(String) : [],
          discriminating_evidence: discriminating,
        };
      }
      return value;
    },
    z.object({
      explanation_id: nonEmptyString,
      statement: nonEmptyString,
      judgment_unit_ids: z.array(z.string()).default([]),
      discriminating_evidence: z.array(z.string().min(1)).min(1),
    }),
  )),
  // 规范双产物：研究逻辑正文 + 本体视图 YAML；document_markdown 与 research_logic_markdown 保持镜像。
  research_logic_markdown: markdown,
  ontology_view_yaml: z.string().min(20),
  logic_id: nonEmptyString,
  ontology_view_ref: nonEmptyString,
  judgment_spine: nonEmptyString,
  framework_usage_ref: nonEmptyString,
  stage_status: stageStatus,
  quality_status: qualityStatus,
  quality_gate_ref: nonEmptyString,
  ontology_gap_scan_status: ontologyGapScanStatus,
  can_enter_03: z.boolean(),
  document_markdown: markdown,
}).superRefine((value, context) => {
  if (value.ontology_gap_scan_status === "blocking_gap" && value.can_enter_03) {
    context.addIssue({
      code: "custom",
      path: ["can_enter_03"],
      message: "blocking_gap 时 can_enter_03 必须为 false",
    });
  }
  if (value.research_logic_markdown.trim() !== value.document_markdown.trim()) {
    context.addIssue({
      code: "custom",
      path: ["document_markdown"],
      message: "document_markdown 必须与 research_logic_markdown 保持一致",
    });
  }
  const unitIds = new Set(value.judgment_units.map((unit) => unit.id));
  const variableIds = new Set(value.variables.map((variable) => variable.id));
  if (value.task_answer_contract) {
    for (const unitId of value.task_answer_contract.required_judgment_unit_ids) {
      if (!unitIds.has(unitId)) {
        context.addIssue({
          code: "custom",
          path: ["task_answer_contract", "required_judgment_unit_ids"],
          message: `根问题闭环合同引用了不存在的判断单元 ${unitId}`,
        });
      }
    }
    for (const [index, coverage] of value.task_answer_contract.hypothesis_coverage.entries()) {
      for (const unitId of coverage.judgment_unit_ids) {
        if (!unitIds.has(unitId)) {
          context.addIssue({
            code: "custom",
            path: ["task_answer_contract", "hypothesis_coverage", index, "judgment_unit_ids"],
            message: `假设覆盖引用了不存在的判断单元 ${unitId}`,
          });
        }
      }
    }
  }
  const pathIds = new Set<string>();
  for (const [index, path] of value.paths.entries()) {
    if (pathIds.has(path.id)) {
      context.addIssue({
        code: "custom",
        path: ["paths", index, "id"],
        message: `传导路径 ID 重复: ${path.id}`,
      });
    }
    pathIds.add(path.id);
    for (const variableId of path.variable_ids) {
      if (!variableIds.has(variableId)) {
        context.addIssue({
          code: "custom",
          path: ["paths", index, "variable_ids"],
          message: `传导路径 ${path.id} 引用了不存在的状态变量 ${variableId}`,
        });
      }
    }
    for (const unitId of path.judgment_unit_ids) {
      if (!unitIds.has(unitId)) {
        context.addIssue({
          code: "custom",
          path: ["paths", index, "judgment_unit_ids"],
          message: `传导路径 ${path.id} 挂接了不存在的判断单元 ${unitId}`,
        });
      }
    }
  }
  const propagationTypes = new Set(["transmission_path", "mechanism_validation", "impact_realization"]);
  for (const [index, unit] of value.judgment_units.entries()) {
    if (!propagationTypes.has(unit.judgment_type)) continue;
    const boundPaths = value.paths.filter((path) => path.judgment_unit_ids.includes(unit.id));
    if (!boundPaths.some((path) => path.variable_ids.length >= 2)) {
      context.addIssue({
        code: "custom",
        path: ["judgment_units", index, "judgment_type"],
        message: `传导/机制/影响判断 ${unit.id} 必须显式绑定至少一条含两个及以上状态变量的路径`,
      });
    }
  }
  for (const [index, item] of value.competing_explanations.entries()) {
    for (const unitId of item.judgment_unit_ids) {
      if (!unitIds.has(unitId)) {
        context.addIssue({
          code: "custom",
          path: ["competing_explanations", index, "judgment_unit_ids"],
          message: `竞争解释挂接了不存在的判断单元 ${unitId}`,
        });
      }
    }
  }
  for (const [index, item] of value.counter_evidence_directions.entries()) {
    for (const unitId of item.judgment_unit_ids) {
      if (!unitIds.has(unitId)) {
        context.addIssue({
          code: "custom",
          path: ["counter_evidence_directions", index, "judgment_unit_ids"],
          message: `反向证据方向挂接了不存在的判断单元 ${unitId}`,
        });
      }
    }
  }
  for (const [index, item] of value.evidence_requirements.entries()) {
    for (const unitId of item.judgment_unit_ids) {
      if (!unitIds.has(unitId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence_requirements", index, "judgment_unit_ids"],
          message: `证据要求挂接了不存在的判断单元 ${unitId}`,
        });
      }
    }
  }
});

const sourceDraft = z.object({
  // 以下运行字段在模型提交时必须显式为 null 或候选值，随后一律由
  // Source Registry 抓取结果覆盖；使用 nullable 而非 optional 以兼容
  // DeepSeek/OpenAI 严格函数 Schema 的“所有字段 required”约束。
  source_id: z.string().nullable(),
  source_key: nonEmptyString,
  url: z.string().url(),
  title: nonEmptyString,
  publisher: z.string(),
  published_at: nonEmptyString,
  source_tier: z.enum(ONTOLOGY_SOURCE_TIERS),
  authority_type: z.enum(["official", "company_disclosure", "industry_provider", "public_secondary", "unknown"]).default("unknown"),
  source_type: nonEmptyString,
  search_excerpt: z.string(),
  locator: nonEmptyString,
  source_quote: nonEmptyString,
  captured_at: z.string().nullable(),
  content_hash: z.string().nullable(),
  final_url: z.string().nullable(),
  retrieval_status: z.string().nullable(),
  // 模型常以 0/1 表达布尔（DeepSeek/OpenAI 函数调用），宽容转换避免整批证据因
  // 单个字段类型不符而在 schemas.stage_03.safeParse 处被整体判废。
  quote_verified: z.preprocess(
    (v) => (typeof v === "number" ? Boolean(v) : v),
    z.boolean().nullable(),
  ),
});

const commercializationStage = z.enum([
  "concept", "sample", "customer_evaluation", "qualification", "design_win",
  "pilot", "mass_production", "repeat_purchase", "scale_adoption",
]);

const qualificationScope = z.object({
  product_spec_ref: z.string().nullable(),
  customer_ref: z.string().nullable(),
  facility_ref: z.string().nullable(),
});

const semiconductorMeasurement = z.object({
  metric_kind: z.enum(["capacity", "yield"]),
  facility_ref: z.string().nullable(),
  wafer_size: z.string().nullable(),
  process_or_product_ref: z.string().nullable(),
  batch_stage: z.string().nullable(),
  unit: z.string().nullable(),
  business_time_basis: z.string().nullable(),
});

const evidenceFactDraft = z.object({
  id: nonEmptyString,
  statement: nonEmptyString,
  kind: z.enum(["source_claim", "fact_draft", "counter", "conflict"]),
  direction: z.enum(["support", "weaken", "neutral", "unknown"]),
  source_keys: z.array(z.string()).min(1),
  // 模型偶把 source_ids 写成 [null, "id", ...]；过滤 null 而非整体判废该草稿。
  source_ids: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) : []),
    z.array(z.string()).default([]),
  ),
  judgment_unit_ids: z.array(z.string()).min(1),
  evidence_requirement_ids: z.array(z.string()).default([]),
  ontology_node_ids: z.array(z.string()),
  subject_ref: nonEmptyString,
  time_basis: nonEmptyString,
  scope_ref: nonEmptyString,
  observed_at: nonEmptyString,
  valid_from: nonEmptyString,
  valid_to: z.string().nullable().default(null),
  published_at: nonEmptyString,
  cutoff_at: nonEmptyString,
  directness: z.enum(ONTOLOGY_ENUMS["EvidenceAssessment.directness"]),
  limitations: z.array(z.string()),
  proxy_disclosure: z.object({
    lag: z.string().nullable(),
    scope: z.string().nullable(),
    non_substitution: z.string().nullable(),
  }).nullable().optional(),
  commercialization_stage: commercializationStage.nullable().optional(),
  qualification_scope: qualificationScope.nullable().optional(),
  semiconductor_measurement: semiconductorMeasurement.nullable().optional(),
});

const evidenceGapDraft = z.object({
  id: nonEmptyString,
  statement: nonEmptyString,
  kind: z.literal("gap"),
  direction: z.literal("unknown"),
  source_keys: z.array(z.string()).max(0),
  source_ids: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) : []),
    z.array(z.string()).default([]),
  ),
  judgment_unit_ids: z.array(z.string()).min(1),
  evidence_requirement_ids: z.array(z.string()).default([]),
  ontology_node_ids: z.array(z.string()),
  requirement: nonEmptyString,
  evidence_role: z.enum(ONTOLOGY_ENUMS["EvidenceRequirement.evidence_role"]),
  minimum_independent_sources: z.number().int().nonnegative(),
  limitations: z.array(z.string()).min(1),
});

/** Evidence Summary：趋势/对比/异常与确定性计算输出；LLM 只能引用其中数字。 */
const evidenceSummarySchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  summary_kind: z.enum(["trend", "distribution", "comparison", "anomaly", "calculation", "other"]).default("other"),
  metric_refs: z.array(z.string()).default([]),
  judgment_unit_ids: z.array(z.string()).default([]),
  statement: nonEmptyString,
  numeric_values: z.array(z.object({
    label: nonEmptyString,
    value: z.union([z.number(), nonEmptyString]),
    unit: z.string().nullable().default(null),
    period: z.string().nullable().default(null),
    source: z.enum(["quote", "calculation", "derived"]).default("quote"),
    evidence_draft_ids: z.array(z.string()).default([]),
  })).default([]),
  evidence_draft_ids: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});

/** Evidence Bundle：按判断单元组织的支持/反证/缺口，供 04 默认消费。 */
const evidenceBundleSchema = z.object({
  judgment_unit_id: nonEmptyString,
  requirement_ids: z.array(z.string()).default([]),
  support_evidence_ids: z.array(z.string()).default([]),
  counter_evidence_ids: z.array(z.string()).default([]),
  gap_ids: z.array(z.string()).default([]),
  summary_ids: z.array(z.string()).default([]),
  readiness: z.enum(["ready", "partial", "not_ready"]).default("partial"),
  notes: z.array(z.string()).default([]),
});

const evidenceRequirementAssessmentSchema = z.object({
  requirement_id: nonEmptyString,
  judgment_unit_id: nonEmptyString,
  evidence_role: z.enum(ONTOLOGY_ENUMS["EvidenceRequirement.evidence_role"]),
  evidence_ids: z.array(z.string()).default([]),
  gap_ids: z.array(z.string()).default([]),
  independent_source_groups: z.number().int().nonnegative(),
  minimum_independent_sources: z.number().int().nonnegative(),
  status: z.enum(["met", "partial", "missing", "blocked"]),
  limitations: z.array(z.string()).default([]),
});

const stage03OntologyPrecheckSchema = z.object({
  findings: z.array(z.object({
    rule_ref: z.enum([
      "semiconductor_proxy_disclosure",
      "semiconductor_qualification_stage_alignment",
      "semiconductor_capacity_yield_scope_alignment",
      "evidence_scope_time_alignment",
    ]),
    severity: z.enum(["advisory", "blocking_soft"]),
    evidence_id: nonEmptyString,
    statement: nonEmptyString,
    message: nonEmptyString,
    researcher_hint: nonEmptyString,
  })).default([]),
  by_rule: z.record(z.string(), z.number().int().nonnegative()).default({}),
  blocking_soft_count: z.number().int().nonnegative(),
  advisory_count: z.number().int().nonnegative(),
});

export const evidencePreparationSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  sources: z.array(sourceDraft),
  evidence_drafts: z.array(z.discriminatedUnion("kind", [evidenceFactDraft, evidenceGapDraft])).min(1),
  evidence_summaries: z.array(evidenceSummarySchema).default([]),
  evidence_bundles: z.array(evidenceBundleSchema).default([]),
  evidence_requirement_assessments: z.array(evidenceRequirementAssessmentSchema).default([]),
  ontology_precheck: stage03OntologyPrecheckSchema.default({
    findings: [],
    by_rule: {},
    blocking_soft_count: 0,
    advisory_count: 0,
  }),
  unresolved_gaps: z.array(z.string()),
  // 规范双产物：数据与证据准备正文 + 跨域实例清单；document_markdown 与 preparation_markdown 镜像。
  preparation_markdown: markdown,
  instance_manifest_yaml: z.string().min(20),
  stage_status: stageStatus,
  quality_status: qualityStatus,
  quality_gate_ref: nonEmptyString,
  deterministic_check_status: z.enum(["not_checked", "checked", "failed"]),
  semantic_review_status: z.enum(["not_reviewed", "reviewed", "rejected"]),
  confidence_ceiling: z.enum(ONTOLOGY_CONFIDENCE_LEVELS),
  coverage_unit_total: z.number().int().nonnegative(),
  evidence_backed_unit_count: z.number().int().nonnegative(),
  evidence_coverage_rate: z.number().min(0).max(1),
  required_coverage_rate: z.number().min(0).max(1),
  critical_node_gate_status: z.enum(["met", "partial", "not_met"]),
  judgment_unit_gate_status: z.enum(["met", "partial", "insufficient"]),
  search_status: z.enum(["not_started", "in_progress", "threshold_met", "source_scarce"]),
  allowed_05_output: z.enum(["full_report", "bounded_report", "gap_report_only"]),
  evidence_readiness: z.enum(["ready", "partial", "not_ready"]),
  delivery_readiness: z.enum(["ready", "partial", "not_ready"]),
  snapshot_ref: nonEmptyString,
  return_required: z.boolean(),
  return_stage: z.string().nullable(),
  // 供 05 引用的交付素材候选（对齐 04_05_materials 意图；可空数组）。
  delivery_materials: z.object({
    chart_candidates: z.array(z.object({
      id: z.string(),
      title: z.string(),
      evidence_draft_ids: z.array(z.string()).default([]),
      note: z.string().nullable().default(null),
    })).default([]),
    table_candidates: z.array(z.object({
      id: z.string(),
      title: z.string(),
      evidence_draft_ids: z.array(z.string()).default([]),
      note: z.string().nullable().default(null),
    })).default([]),
    source_annotation_candidates: z.array(z.object({
      id: z.string(),
      source_id: z.string().nullable().default(null),
      source_key: z.string().nullable().default(null),
      annotation: z.string(),
    })).default([]),
  }).default({ chart_candidates: [], table_candidates: [], source_annotation_candidates: [] }),
  document_markdown: markdown,
}).superRefine((value, context) => {
  if (value.preparation_markdown.trim() !== value.document_markdown.trim()) {
    context.addIssue({
      code: "custom",
      path: ["document_markdown"],
      message: "document_markdown 必须与 preparation_markdown 保持一致",
    });
  }
  if (value.evidence_readiness === "not_ready" && value.allowed_05_output === "full_report") {
    context.addIssue({
      code: "custom",
      path: ["allowed_05_output"],
      message: "evidence_readiness=not_ready 时 allowed_05_output 不得为 full_report",
    });
  }
  const evidenceIds = new Set(value.evidence_drafts.map((item) => item.id));
  const referencedEvidenceIds = new Set(value.method_applications.flatMap((item) => item.input_evidence_refs));
  for (const [index, application] of value.method_applications.entries()) {
    if (["blocked", "rejected"].includes(application.status) && !application.alternatives.length) {
      context.addIssue({ code: "custom", path: ["method_applications", index, "alternatives"], message: `${application.status} 方法必须记录替代路线` });
    }
    for (const ref of application.input_evidence_refs) {
      if (!evidenceIds.has(ref)) context.addIssue({ code: "custom", path: ["method_applications", index, "input_evidence_refs"], message: `引用了不存在的证据或缺口 ${ref}` });
    }
  }
  for (const [index, evidence] of value.evidence_drafts.entries()) {
    if (!referencedEvidenceIds.has(evidence.id)) {
      context.addIssue({ code: "custom", path: ["evidence_drafts", index, "id"], message: `${evidence.id} 必须绑定至少一个 MethodApplication` });
    }
  }
  if (!value.sources.length && value.evidence_drafts.some((item) => item.kind !== "gap")) {
    context.addIssue({ code: "custom", path: ["sources"], message: "无来源时只能登记显式 gap，不得形成事实草稿" });
  }
  if (!value.sources.length && !value.unresolved_gaps.length) {
    context.addIssue({ code: "custom", path: ["unresolved_gaps"], message: "无来源时必须明确记录未解决证据缺口" });
  }
});

export const judgmentDecisionSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  signals: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    role: z.enum(ONTOLOGY_ENUMS["Signal.role"]),
    evidence_draft_ids: z.array(z.string()).min(1),
    judgment_unit_ids: z.array(z.string()).min(1),
    target_hypothesis_ids: z.array(z.string()).min(1),
  })),
  hypotheses: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    signal_ids: z.array(z.string()),
    falsification_conditions: z.array(z.string()).min(1),
    time_horizon: nonEmptyString,
    judgment_unit_ids: z.array(z.string()).default([]),
  })).min(1),
  competing_explanations: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    signal_ids: z.array(z.string()),
    discriminating_evidence: z.array(z.string()).min(1),
    status: z.enum(["active", "weakened", "eliminated", "unknown"]),
    elimination_rationale: z.string(),
    source_explanation_id: z.string().nullable().optional(),
    judgment_unit_ids: z.array(z.string()).default([]),
  })).min(1),
  rule_evaluations: z.array(z.object({
    id: nonEmptyString,
    rule_ref: nonEmptyString,
    input_refs: z.array(z.string()).min(1),
    condition_results: z.array(z.object({
      condition_id: nonEmptyString,
      expression: nonEmptyString,
      input_refs: z.array(z.string()).min(1),
      outcome: z.enum(ONTOLOGY_ENUMS["RuleEvaluation.result"]),
      rationale: nonEmptyString,
    })).min(1),
    result: z.enum(ONTOLOGY_ENUMS["RuleEvaluation.result"]),
    deterministic_result: z.object({
      engine_version: nonEmptyString,
      result: z.enum(ONTOLOGY_ENUMS["RuleEvaluation.result"]),
      rationale: nonEmptyString,
      evaluated_at: nonEmptyString,
    }).nullable(),
  })).min(1),
  judgments: z.array(z.object({
    id: nonEmptyString,
    judgment_unit_id: nonEmptyString,
    title: nonEmptyString,
    conclusion: nonEmptyString,
    rationale: nonEmptyString,
    strength: z.enum(ONTOLOGY_JUDGMENT_LEVELS),
    confidence: z.enum(ONTOLOGY_CONFIDENCE_LEVELS),
    decision_status: z.enum(ONTOLOGY_ENUMS["Judgment.decision_status"]),
    conflict_status: z.enum(ONTOLOGY_ENUMS["Judgment.conflict_status"]),
    not_judgeable_reason: z.string().nullable().default(null),
    scope_ref: nonEmptyString,
    cutoff_at: nonEmptyString,
    conditions: z.array(z.string()),
    supporting_evidence_draft_ids: z.array(z.string()),
    counter_evidence_draft_ids: z.array(z.string()),
    hypothesis_ids: z.array(z.string()).min(1),
    rule_evaluation_ids: z.array(z.string()).min(1),
    method_application_ids: z.array(z.string()).min(1),
    ontology_node_ids: z.array(z.string()),
    uncertainties: z.array(z.string()),
    invalidation_conditions: z.array(z.string()).min(1),
    tracking_signals: z.array(z.string()),
    claimed_commercialization_stage: commercializationStage.nullable().optional(),
    qualification_claim_scope: qualificationScope.nullable().optional(),
    semiconductor_claim_scope: semiconductorMeasurement.nullable().optional(),
  })).min(1),
  // Public Contract Claim (C-nn)：由 judgments 确定性投影；旧产物缺省由 ensureStage04 / 只读适配器补齐。
  claims: z.array(z.object({
    id: nonEmptyString,
    judgment_id: nonEmptyString,
    statement: nonEmptyString,
    strength: z.enum(ONTOLOGY_JUDGMENT_LEVELS),
    evidence_refs: z.array(z.string()).default([]),
    method_application_ids: z.array(z.string()).default([]),
    scope_ref: z.string().default(""),
  })).default([]),
  reasoning_traces: z.array(z.object({
    id: nonEmptyString,
    judgment_id: nonEmptyString,
    node_ids: z.array(z.string()).min(1),
    created_at: nonEmptyString,
  })).min(1),
  market_expectations: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    subject_ref: nonEmptyString,
    metric_ref: z.string().nullable().optional(),
    horizon: nonEmptyString,
    consensus_basis: z.enum(ONTOLOGY_ENUMS["MarketExpectation.consensus_basis"]),
    scope_ref: nonEmptyString,
    as_of: nonEmptyString,
    source_refs: z.array(z.string()).min(1),
  })).default([]),
  expectation_gaps: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    direction: z.enum(ONTOLOGY_ENUMS["ExpectationGap.direction"]),
    gap_kind: z.enum(ONTOLOGY_ENUMS["ExpectationGap.gap_kind"]),
    judgment_ref: nonEmptyString,
    market_expectation_ref: nonEmptyString,
    basis_refs: z.array(z.string()).min(1),
    invalidation_conditions: z.array(z.string()).min(1),
  })).default([]),
  asset_impacts: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    source_judgment_refs: z.array(z.string()).min(1),
    target_object_ref: nonEmptyString,
    impact_channel: z.enum(ONTOLOGY_ENUMS["AssetImpact.impact_channel"]),
    direction: z.enum(ONTOLOGY_ENUMS["AssetImpact.direction"]),
    time_horizon: nonEmptyString,
    conditions: z.array(z.string()).min(1),
    limitations: z.array(z.string()).default([]),
  })).default([]),
  overall_boundary: nonEmptyString,
  // 规范双产物：判断简报 + 推理审计 YAML；document_markdown 与 judgment_brief_markdown 镜像。
  judgment_brief_markdown: markdown,
  reasoning_audit_yaml: z.string().min(20),
  stage_status: stageStatus,
  quality_status: qualityStatus,
  quality_gate_ref: nonEmptyString,
  deterministic_check_status: z.enum(["not_checked", "checked", "failed"]),
  semantic_review_status: z.enum(["not_reviewed", "reviewed", "rejected"]),
  confidence: z.enum(ONTOLOGY_CONFIDENCE_LEVELS),
  judgment_level: z.enum(ONTOLOGY_JUDGMENT_LEVELS),
  primary_claim_id: nonEmptyString,
  audit_ref: nonEmptyString,
  brief_ref: nonEmptyString,
  brief_quality_check_result: z.enum(["pass", "fail"]),
  judgment_as_of: nonEmptyString,
  // 05 上游供给：对象分化 / 主路径裁决 / 投资命题 / 表达许可分层。
  object_differentiation: z.string().default(""),
  primary_path_ruling: z.string().default(""),
  investment_proposition: z.string().default(""),
  expression_permission: z.object({
    allowed_core_claims: z.array(z.string()).default([]),
    restricted_claims: z.array(z.string()).default([]),
    prohibited_claims: z.array(z.string()).default([]),
    allowed_mechanisms: z.array(z.string()).default([]),
    restricted_phrasing: z.array(z.string()).default([]),
    max_expression_level: z.enum(ONTOLOGY_JUDGMENT_LEVELS).default("J0"),
    notes: z.string().default(""),
  }).default({
    allowed_core_claims: [],
    restricted_claims: [],
    prohibited_claims: [],
    allowed_mechanisms: [],
    restricted_phrasing: [],
    max_expression_level: "J0",
    notes: "",
  }),
  document_markdown: markdown,
}).superRefine((value, context) => {
  if (value.judgment_brief_markdown.trim() !== value.document_markdown.trim()) {
    context.addIssue({
      code: "custom",
      path: ["document_markdown"],
      message: "document_markdown 必须与 judgment_brief_markdown 保持一致",
    });
  }
  const hypotheses = new Map(value.hypotheses.map((item) => [item.id, item]));
  for (const [index, judgment] of value.judgments.entries()) {
    const explicitJ0Stop = judgment.strength === "J0"
      && ["blocked", "indeterminate", "contested"].includes(judgment.decision_status)
      && Boolean(judgment.not_judgeable_reason?.trim());
    if (!explicitJ0Stop && ![...judgment.supporting_evidence_draft_ids, ...judgment.counter_evidence_draft_ids].length) {
      context.addIssue({ code: "custom", path: ["judgments", index], message: "非 J0 停止判断必须绑定事实级证据" });
    }
    if (!explicitJ0Stop && judgment.hypothesis_ids.some((id) => !(hypotheses.get(id)?.signal_ids.length))) {
      context.addIssue({ code: "custom", path: ["judgments", index, "hypothesis_ids"], message: "非 J0 停止判断的假设必须由 Signal 评价" });
    }
  }
});

export const researchExpressionSchema = z.object({
  title: nonEmptyString,
  executive_points: z.array(z.string()),
  report_claims: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    judgment_ids: z.array(z.string()).min(1),
    method_application_ids: z.array(z.string()).min(1),
    evidence_draft_ids: z.array(z.string()),
    source_ids: z.array(z.string()),
  })),
  limitations: z.array(z.string()),
  // 主研报继续用 document_markdown；表达审计 YAML 为配对产物。
  expression_audit_yaml: z.string().min(20),
  stage_status: stageStatus,
  quality_status: qualityStatus,
  quality_gate_ref: nonEmptyString,
  deterministic_check_status: z.enum(["not_checked", "checked", "failed"]),
  semantic_review_status: z.enum(["not_reviewed", "reviewed", "rejected"]),
  source_04_brief_ref: nonEmptyString,
  source_04_audit_ref: nonEmptyString,
  delivery_ref: nonEmptyString,
  delivery_archetype: z.string().default("industry_cycle_report"),
  research_edge: z.array(z.object({
    market_view: z.string(),
    differentiated_view: z.string(),
    underestimated_mechanism: z.string().nullable().default(null),
    falsifier: z.string().nullable().default(null),
    evidence_boundary: z.string().nullable().default(null),
  })).default([]),
  argument_chapters: z.array(z.string()).default([]),
  research_value_review: z.object({
    status: z.enum(["pass", "fail", "skipped"]).default("skipped"),
    checks: z.array(z.object({
      id: z.string(),
      pass: z.boolean(),
      score: z.number().int().min(0).max(4).default(0),
      evidence_span: z.string().default(""),
      note: z.string().default(""),
    })).default([]),
    retry_count: z.number().int().min(0).default(0),
    total_score: z.number().int().min(0).max(20).default(0),
    pass_threshold: z.number().int().min(0).max(20).default(16),
    reviewed_at: z.string().nullable().default(null),
    mode: z.enum(["heuristic", "llm", "combined"]).default("heuristic"),
    reviewer_model: z.string().nullable().default(null),
    producer_model: z.string().nullable().default(null),
  }).nullable().default(null),
  expression_permission_summary: z.object({
    allowed_core_claims: z.array(z.string()).default([]),
    restricted_claims: z.array(z.string()).default([]),
    prohibited_claims: z.array(z.string()).default([]),
    allowed_mechanisms: z.array(z.string()).default([]),
    restricted_phrasing: z.array(z.string()).default([]),
    max_expression_level: z.string().default(""),
    notes: z.string().default(""),
  }).nullable().default(null),
  document_markdown: markdown,
});

export const baselineSchema = z.object({
  frozen_stage03_artifact_id: z.string().nullable(),
  frozen_stage03_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  title: nonEmptyString,
  core_claims: z.array(z.object({ id: nonEmptyString, statement: nonEmptyString, source_keys: z.array(z.string()) })),
  counterpoints: z.array(z.string()),
  limitations: z.array(z.string()),
  sources: z.array(sourceDraft),
  document_markdown: markdown,
});

export const schemas = {
  stage_01: taskDefinitionSchema,
  stage_02: judgmentStructureSchema,
  stage_03: evidencePreparationSchema,
  stage_04: judgmentDecisionSchema,
  stage_05: researchExpressionSchema,
  baseline: baselineSchema,
  independent_review: independentReviewSchema,
};
export type SchemaKind = keyof typeof schemas;

export {
  EVALUATION_CRITERIA,
  evaluationSchema,
  evaluationSubmissionSchema,
  independentReviewSchema,
  taskDefinitionSchema,
};
