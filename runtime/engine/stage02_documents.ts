/** Stage02 双产物（研究逻辑.md + 本体视图.yaml）同步与一致性门禁。 */

import "server-only";
import YAML from "yaml";
import {
  applyHighQualityGate,
  bodyMeetsMinDensity,
  downgradeIfHighQualityFails,
  looksLikePlaceholder,
  nonEmptyText,
  requireDeterministicChecked,
  type StageQualityIssue,
} from "./stage_high_quality";
import { normalizeMethodApplicationNulls } from "./evidence_draft_normalize";
import { applyEvidenceRequirementBindings } from "./evidence_requirement_bindings";

export const STAGE02_QUALITY_GATE_REF =
  "workflow/stages/02_结构/02_判断结构与本体视图规范.md#7-质量门槛与返工规则";

function nonEmpty(value: unknown, fallback = ""): string {
  return nonEmptyText(value, fallback);
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function ensureTaskAnswerContract(data: any, question = ""): void {
  const units = Array.isArray(data?.judgment_units) ? data.judgment_units : [];
  const unitIds = units.map((unit: any) => nonEmpty(unit?.id)).filter(Boolean);
  const criticalIds = units
    .filter((unit: any) => String(unit?.priority_tier || "") === "critical")
    .map((unit: any) => nonEmpty(unit?.id))
    .filter(Boolean);
  const existing = data?.task_answer_contract && typeof data.task_answer_contract === "object"
    ? data.task_answer_contract
    : {};
  const required = asList(existing.required_judgment_unit_ids)
    .filter((unitId) => unitIds.includes(unitId));
  data.task_answer_contract = {
    root_question_ref: nonEmpty(
      existing.root_question_ref,
      nonEmpty(data?.questions?.[0]?.id, "RQ-01"),
    ),
    root_question: nonEmpty(
      existing.root_question,
      nonEmpty(question, nonEmpty(data?.research_scope?.label, data?.judgment_spine)),
    ),
    required_judgment_unit_ids: required.length
      ? required
      : (criticalIds.length ? criticalIds : unitIds),
    synthesis_operator: [
      "all_required",
      "weighted",
      "conditional",
      "comparative",
      "custom",
    ].includes(String(existing.synthesis_operator))
      ? String(existing.synthesis_operator)
      : "conditional",
    synthesis_rule: nonEmpty(
      existing.synthesis_rule,
      "逐一裁决全部必需判断单元并保留对象分化；不得用单一均值或材料数量替代根问题回答。",
    ),
    blocking_policy: nonEmpty(
      existing.blocking_policy,
      "任一必需判断单元为 J0、存在未关闭阻断或关键反证缺口时，根问题只能输出有边界的部分回答或暂不可判断。",
    ),
    hypothesis_coverage: Array.isArray(existing.hypothesis_coverage)
      ? existing.hypothesis_coverage
      : [],
  };
}

function normalizePathBindings(data: any): void {
  const units = Array.isArray(data?.judgment_units) ? data.judgment_units : [];
  const unitIdsByPath = new Map<string, string[]>();
  for (const unit of units) {
    const unitId = nonEmpty(unit?.id || unit?.judgment_unit_id);
    if (!unitId) continue;
    for (const pathId of asList(unit?.linked_paths || unit?.path_ids || unit?.path_refs)) {
      const current = unitIdsByPath.get(pathId) || [];
      if (!current.includes(unitId)) current.push(unitId);
      unitIdsByPath.set(pathId, current);
    }
  }
  if (!Array.isArray(data?.paths)) return;
  data.paths = data.paths.map((path: any) => {
    const id = nonEmpty(path?.id || path?.path_id);
    const explicit = asList(
      path?.judgment_unit_ids
      || path?.linked_judgment_units
      || path?.judgment_unit_refs,
    );
    return {
      ...path,
      id,
      variable_ids: asList(path?.variable_ids || path?.state_variable_refs),
      judgment_unit_ids: [...new Set([...explicit, ...(unitIdsByPath.get(id) || [])])],
    };
  });
}

export function defaultOntologyViewRef(logicId = "RLOG-RUNTIME"): string {
  return `02-研究逻辑配对本体视图-${logicId}.yaml`;
}

/** 从执行字段投影最小可审阅本体视图 YAML（模型未给全文时的兜底）。 */
export function projectOntologyViewYaml(data: any, options: { taskId?: string; question?: string } = {}): string {
  normalizePathBindings(data);
  ensureTaskAnswerContract(data, options.question);
  const logicId = nonEmpty(data?.logic_id, "RLOG-RUNTIME");
  const viewRef = nonEmpty(data?.ontology_view_ref, defaultOntologyViewRef(logicId));
  const units = Array.isArray(data?.judgment_units) ? data.judgment_units : [];
  const evidenceRequirements = Array.isArray(data?.evidence_requirements) ? data.evidence_requirements : [];
  const variables = Array.isArray(data?.variables) ? data.variables : [];
  const paths = Array.isArray(data?.paths) ? data.paths : [];
  const gapStatus = nonEmpty(data?.ontology_gap_scan_status, "minor_gap");
  const canEnter = data?.can_enter_03 !== false && gapStatus !== "blocking_gap";
  const payload = {
    schema_name: "task_ontology_view",
    schema_version: "2.2.0",
    task_context: {
      task_id: nonEmpty(options.taskId, "JTASK-RUNTIME"),
      logic_document: nonEmpty(data?.logic_id, logicId),
      ontology_view_ref: viewRef,
      normalized_question: nonEmpty(options.question, data?.research_scope?.label),
      research_scope_id: nonEmpty(data?.research_scope?.id),
      judgment_spine: nonEmpty(data?.judgment_spine, "待在研究逻辑中展开核心待验证命题"),
    },
    quality_control: {
      stage_status: nonEmpty(data?.stage_status, "complete"),
      quality_status: nonEmpty(data?.quality_status, canEnter ? "minimum_pass" : "return_required"),
      quality_gate_ref: nonEmpty(data?.quality_gate_ref, STAGE02_QUALITY_GATE_REF),
      ontology_gap_scan_status: gapStatus,
      can_enter_03: canEnter,
    },
    research_framework: {
      framework_execution: nonEmpty(data?.framework_usage_ref, "runtime-controlled"),
      minimum_question_tree: (Array.isArray(data?.questions) ? data.questions : []).map((item: any) => ({
        id: nonEmpty(item?.id),
        statement: nonEmpty(item?.statement || item?.question),
        failure_route: nonEmpty(item?.failure_route, "return_to_structure"),
      })),
    },
    judgment_units: units.map((unit: any) => ({
      id: nonEmpty(unit?.id),
      title: nonEmpty(unit?.title),
      question: nonEmpty(unit?.question),
      judgment_type: nonEmpty(unit?.judgment_type),
      scope_ref: nonEmpty(unit?.scope_ref),
      ontology_node_ids: asList(unit?.ontology_node_ids),
      linked_paths: paths
        .filter((path: any) => asList(path?.judgment_unit_ids).includes(nonEmpty(unit?.id)))
        .map((path: any) => nonEmpty(path?.id))
        .filter(Boolean),
      evidence_requirements: asList(unit?.evidence_requirements),
    })),
    task_answer_contract: data.task_answer_contract,
    path_design: paths.map((path: any) => ({
      id: nonEmpty(path?.id),
      statement: nonEmpty(path?.statement),
      variable_ids: asList(path?.variable_ids),
      judgment_unit_ids: asList(path?.judgment_unit_ids),
    })),
    ontology_bindings: {
      variables: variables.map((variable: any) => ({
        id: nonEmpty(variable?.id),
        name: nonEmpty(variable?.name),
        ontology_node_id: nonEmpty(variable?.ontology_node_id),
        variable_kind: nonEmpty(variable?.variable_kind),
        anchors: asList(variable?.anchors),
        linked_judgment_units: paths
          .filter((path: any) => asList(path?.variable_ids).includes(nonEmpty(variable?.id)))
          .flatMap((path: any) => asList(path?.judgment_unit_ids))
          .filter((unitId: string, index: number, all: string[]) => all.indexOf(unitId) === index),
      })),
    },
    evidence_requirements: evidenceRequirements.map((item: any) => ({
      id: nonEmpty(item?.id),
      requirement: nonEmpty(item?.requirement),
      evidence_role: nonEmpty(item?.evidence_role),
      judgment_unit_ids: asList(item?.judgment_unit_ids),
      minimum_independent_sources: Number(item?.minimum_independent_sources || 1),
      evidence_profile_refs: asList(item?.evidence_profile_refs),
      evidence_recipe_ref: nonEmpty(item?.evidence_recipe_ref) || null,
      derivation_refs: item?.derivation_refs || null,
      no_profile_reason: nonEmpty(item?.no_profile_reason) || null,
    })),
    ontology_gaps: {
      status: gapStatus,
      items: gapStatus === "no_gap" ? [] : [{
        gap_id: "GAP-RUNTIME-SCAN",
        summary: gapStatus === "blocking_gap"
          ? "存在阻断性本体缺口，不得进入 03"
          : "运行时投影登记的待复核本体缺口",
      }],
    },
    handoff_to_03: {
      can_enter_03: canEnter,
      notes: canEnter ? "执行字段与本体视图已配对，可进入证据准备。" : "缺口未关闭，禁止进入 03。",
    },
    validation: {
      checks: [
        { id: "dual_artifact_present", status: "pass" },
        { id: "judgment_unit_ids_aligned", status: "pass" },
      ],
    },
  };
  return YAML.stringify(payload);
}

/** 补齐 Stage02 门禁与双产物字段；markdown_content 以 research_logic_markdown 为准。原地写入。 */
export function ensureStage02DocumentFields(data: any, options: { question?: string; taskId?: string } = {}): any {
  const next = data && typeof data === "object" ? data : {};
  normalizePathBindings(next);
  applyEvidenceRequirementBindings(next);
  ensureTaskAnswerContract(next, options.question);
  const logicId = nonEmpty(next.logic_id, "RLOG-RUNTIME");
  next.logic_id = logicId;
  next.ontology_view_ref = nonEmpty(next.ontology_view_ref, defaultOntologyViewRef(logicId));
  next.stage_status = nonEmpty(next.stage_status, "complete");
  next.quality_gate_ref = nonEmpty(next.quality_gate_ref, STAGE02_QUALITY_GATE_REF);
  next.judgment_spine = nonEmpty(
    next.judgment_spine,
    `围绕「${nonEmpty(next.research_scope?.label, options.question || "本次研究问题")}」区分主解释与竞争解释，并明确证据门槛。`,
  );
  next.framework_usage_ref = nonEmpty(
    next.framework_usage_ref,
    "ontology_view.research_framework.framework_execution",
  );
  next.ontology_gap_scan_status = nonEmpty(next.ontology_gap_scan_status, "minor_gap");
  if (next.can_enter_03 == null) {
    next.can_enter_03 = next.ontology_gap_scan_status !== "blocking_gap";
  } else {
    next.can_enter_03 = Boolean(next.can_enter_03);
  }
  next.quality_status = nonEmpty(
    next.quality_status,
    next.can_enter_03 ? "minimum_pass" : "return_required",
  );
  next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  next.semantic_review_status = nonEmpty(next.semantic_review_status, "not_reviewed");

  const logicFromAlias = nonEmpty(next.research_logic_markdown, nonEmpty(next.document_markdown));
  if (logicFromAlias) next.research_logic_markdown = logicFromAlias;
  if (!nonEmpty(next.ontology_view_yaml)) {
    next.ontology_view_yaml = projectOntologyViewYaml(next, options);
  }
  // 兼容旧 UI：document_markdown 始终镜像研究逻辑正文
  if (nonEmpty(next.research_logic_markdown)) {
    next.document_markdown = next.research_logic_markdown;
  }

  // 模型可提出研究内容，但 JSON ↔ 本体视图的执行合同必须由平台确定性治理。
  // 若模型 YAML 使用了另一套嵌套布局或漏掉执行单元，就从已校验 JSON 重投影；
  // 原始模型内容仍在 artifact.raw_model_output 中保留审计，不让字段风格差异污染 03。
  const projectionBlockingCodes = new Set([
    "ontology_yaml_parse",
    "unit_missing_in_yaml",
    "unit_missing_in_json",
    "path_missing_in_yaml",
    "path_missing_in_json",
    "path_binding_mismatch",
    "can_enter_03_mismatch",
  ]);
  const projectionErrors = collectStage02ConsistencyIssues(next)
    .filter((item) => item.severity === "error" && projectionBlockingCodes.has(item.code));
  if (projectionErrors.length) {
    next.ontology_view_yaml = projectOntologyViewYaml(next, options);
  }

  if (nonEmpty(next.quality_status) === "high_quality_pass") {
    const provisional = { ...next, deterministic_check_status: "checked" };
    const hqErrors = collectStage02HighQualityIssues(provisional);
    if (hqErrors.length) downgradeIfHighQualityFails(next, hqErrors);
    else next.deterministic_check_status = "checked";
  }
  return next;
}

/**
 * 模型补交通常只漏 MethodApplication 的空数组字段。这里仅补合同空值，
 * 不替模型选择方法、不新增 MA，也不改写研究判断。
 */
export function repairStage02GenerationDraft(
  data: any,
  options: { question?: string; taskId?: string } = {},
): any {
  const next = data && typeof data === "object" ? data : {};
  if (Array.isArray(next.method_applications)) {
    const usedApplicationIds = new Set<string>();
    next.method_applications = next.method_applications.map((item: any, index: number) => {
      const normalized = normalizeMethodApplicationNulls(item) as any;
      if (!normalized || typeof normalized !== "object") return normalized;

      // 模型常把合法 ID 写成小写、空格分隔或直接使用方法名。Stage02 的
      // application_id 只是本轮稳定键，可做无损的确定性规范化，避免为格式
      // 偏差重跑整轮模型。
      const rawId = nonEmpty(normalized.application_id, `STAGE02-${index + 1}`)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const baseId = /^MA-[A-Z0-9_-]+$/.test(rawId)
        ? rawId
        : `MA-${rawId.replace(/^MA[-_]?/, "") || `STAGE02-${index + 1}`}`;
      let applicationId = baseId;
      let suffix = 2;
      while (usedApplicationIds.has(applicationId)) {
        applicationId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedApplicationIds.add(applicationId);

      // Stage02 只登记候选方法，不执行方法。模型误填的证据输入、信号输出、
      // 判断输出和执行摘要均属于阶段越权信息，必须在 schema/语义校验前清空。
      normalized.application_id = applicationId;
      normalized.status = "candidate";
      normalized.input_evidence_refs = [];
      normalized.output_signal_refs = [];
      normalized.output_judgment_refs = [];
      normalized.execution_summary = "";
      normalized.provenance = {
        ...(normalized.provenance && typeof normalized.provenance === "object"
          ? normalized.provenance
          : {}),
        stage: "stage_02",
        source_application_id: null,
        actor: nonEmpty(normalized.provenance?.actor, "model"),
        recorded_at: null,
      };
      return normalized;
    });
  }
  if (Array.isArray(next.judgment_units)) {
    next.judgment_units = next.judgment_units.map((unit: any) => {
      if (!unit || typeof unit !== "object" || unit.decision_weight == null) return unit;
      const rawWeight = Number(unit.decision_weight);
      if (!Number.isFinite(rawWeight)) return { ...unit, decision_weight: null };
      // 40/35/25 是模型最常见的百分制表达；合同统一保存为 0–1。
      const scaled = rawWeight > 1 && rawWeight <= 100 ? rawWeight / 100 : rawWeight;
      return { ...unit, decision_weight: Math.min(1, Math.max(0, scaled)) };
    });
  }
  return ensureStage02DocumentFields(next, options);
}

export type Stage02ConsistencyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

/** Stage02 high_quality：对齐 02 §8.2 语义门槛（密度 + 反证/停止条件/框架理由/权重提示）。 */
export function collectStage02HighQualityIssues(data: any): StageQualityIssue[] {
  const issues: StageQualityIssue[] = [];
  const logic = nonEmpty(data?.research_logic_markdown, data?.document_markdown);
  if (!bodyMeetsMinDensity(logic, 800)) {
    issues.push({
      severity: "error",
      code: "stage02_logic_thin",
      message: "high_quality 要求研究逻辑达到可支撑 05 论点章的密度（≥800 字）",
    });
  }
  if (looksLikePlaceholder(data?.judgment_spine) || nonEmpty(data?.judgment_spine).length < 24) {
    issues.push({
      severity: "error",
      code: "judgment_spine_thin",
      message: "high_quality 要求 judgment_spine 写清核心待验证命题",
    });
  }
  const units = Array.isArray(data?.judgment_units) ? data.judgment_units : [];
  if (units.length < 2) {
    issues.push({
      severity: "error",
      code: "judgment_units_thin",
      message: "high_quality 要求至少 2 个判断单元，避免单一均值叙事",
    });
  }
  const ces = Array.isArray(data?.competing_explanations) ? data.competing_explanations : [];
  const substantiveCe = ces.filter((item: any) =>
    nonEmpty(item?.statement).length >= 8
    && (Array.isArray(item?.discriminating_evidence)
      ? item.discriminating_evidence.length > 0
      : nonEmpty(item?.discriminating_evidence).length >= 4),
  );
  if (!substantiveCe.length) {
    issues.push({
      severity: "error",
      code: "competing_explanations_thin",
      message: "high_quality 要求至少 1 条带可区分证据的竞争解释",
    });
  }
  const unitsMissingCompetingExplanation = units
    .map((unit: any) => String(unit?.id || ""))
    .filter((unitId: string) => unitId && !substantiveCe.some((item: any) =>
      Array.isArray(item?.judgment_unit_ids)
      && item.judgment_unit_ids.map(String).includes(unitId),
    ));
  if (unitsMissingCompetingExplanation.length) {
    issues.push({
      severity: "error",
      code: "competing_explanation_unit_coverage",
      message: `high_quality 要求每个判断单元都有可区分的竞争解释；缺少：${unitsMissingCompetingExplanation.join(", ")}`,
    });
  }
  const counters = Array.isArray(data?.counter_evidence_directions) ? data.counter_evidence_directions : [];
  const substantiveCd = counters.filter((item: any) => nonEmpty(item?.statement).length >= 8);
  if (!substantiveCd.length) {
    issues.push({
      severity: "error",
      code: "counter_evidence_directions_thin",
      message: "high_quality 要求至少 1 条可执行的反证方向（非空 statement）",
    });
  }
  const unitsMissingCounterDirection = units
    .map((unit: any) => String(unit?.id || ""))
    .filter((unitId: string) => unitId && !substantiveCd.some((item: any) =>
      Array.isArray(item?.judgment_unit_ids)
      && item.judgment_unit_ids.map(String).includes(unitId),
    ));
  if (unitsMissingCounterDirection.length) {
    issues.push({
      severity: "error",
      code: "counter_direction_unit_coverage",
      message: `high_quality 要求每个判断单元都有可执行反证方向；缺少：${unitsMissingCounterDirection.join(", ")}`,
    });
  }
  const ers = Array.isArray(data?.evidence_requirements) ? data.evidence_requirements : [];
  const taskAnswer = data?.task_answer_contract;
  const requiredUnitIds = new Set(asList(taskAnswer?.required_judgment_unit_ids));
  const knownUnitIds = new Set(units.map((unit: any) => String(unit?.id || "")).filter(Boolean));
  if (
    !taskAnswer
    || !nonEmpty(taskAnswer?.root_question)
    || !nonEmpty(taskAnswer?.synthesis_rule)
    || !nonEmpty(taskAnswer?.blocking_policy)
    || !requiredUnitIds.size
  ) {
    issues.push({
      severity: "error",
      code: "task_answer_contract_missing",
      message: "high_quality 要求声明 01 根问题如何由 02 必需判断单元合成回答，以及何时必须降级/停止",
    });
  } else {
    const unknownRequired = [...requiredUnitIds].filter((unitId) => !knownUnitIds.has(unitId));
    if (unknownRequired.length) {
      issues.push({
        severity: "error",
        code: "task_answer_contract_unknown_unit",
        message: `根问题闭环合同引用了不存在的判断单元：${unknownRequired.join(", ")}`,
      });
    }
  }
  const multiUnitRequirements = ers.filter((item: any) => asList(item?.judgment_unit_ids).length !== 1);
  if (multiUnitRequirements.length) {
    issues.push({
      severity: "error",
      code: "evidence_requirement_not_atomic",
      message: `一条 EvidenceRequirement 必须只服务一个原子判断单元；异常：${multiUnitRequirements.map((item: any) => item?.id).join(", ")}`,
    });
  }
  const mainRoles = new Set(["support", "boundary"]);
  const unitsMissingMainRequirement = units
    .map((unit: any) => String(unit?.id || ""))
    .filter((unitId: string) => unitId && !ers.some((item: any) =>
      asList(item?.judgment_unit_ids).includes(unitId)
      && mainRoles.has(String(item?.evidence_role)),
    ));
  if (unitsMissingMainRequirement.length) {
    issues.push({
      severity: "error",
      code: "main_requirement_unit_coverage",
      message: `high_quality 要求每个判断单元至少有一条主证据/边界 EvidenceRequirement；缺少：${unitsMissingMainRequirement.join(", ")}`,
    });
  }
  if (!ers.some((item: any) => String(item?.evidence_role) === "counter")) {
    issues.push({
      severity: "error",
      code: "counter_evidence_role_missing",
      message: "high_quality 要求 evidence_requirements 中至少有 1 条 counter 角色，区分主证与反证",
    });
  }
  const counterErs = ers.filter((item: any) => String(item?.evidence_role) === "counter");
  const unitsMissingCounterRequirement = units
    .map((unit: any) => String(unit?.id || ""))
    .filter((unitId: string) => unitId && !counterErs.some((item: any) =>
      Array.isArray(item?.judgment_unit_ids)
      && item.judgment_unit_ids.map(String).includes(unitId),
    ));
  if (unitsMissingCounterRequirement.length) {
    issues.push({
      severity: "error",
      code: "counter_requirement_unit_coverage",
      message: `high_quality 要求每个判断单元都把反证方向投影为 counter EvidenceRequirement；缺少：${unitsMissingCounterRequirement.join(", ")}`,
    });
  }
  // “最低/最小验证条件”本身就是研究停止条件；不得因标题措辞不同把
  // 已逐判断单元写清证据充分阈值的研究稿误判成返工。
  if (!/(?:停止条件|最低验证条件|最小验证条件|证据充分条件|结束研究条件)/.test(logic)) {
    issues.push({
      severity: "error",
      code: "stop_condition_section_missing",
      message: "high_quality 要求研究逻辑写明停止条件或最低验证条件（而非材料越多越好）",
    });
  }
  if (/继续收集更多资料|材料足够多|尽量多收集/.test(logic)) {
    const vagueClauses = [...logic.matchAll(/[^。；\n]*?(继续收集更多资料|材料足够多|尽量多收集)[^。；\n]*/g)];
    const positiveVague = vagueClauses.some((match) => !/不是|并非|不得|禁止|而非|避免|不要/.test(match[0]));
    if (positiveVague) {
      issues.push({
        severity: "error",
        code: "stop_condition_vague",
        message: "high_quality：停止条件不得写成「继续收集更多资料/材料足够多」",
      });
    }
  }
  if (!/框架|裁剪|选用|为何选用|output_gate/.test(logic)) {
    issues.push({
      severity: "error",
      code: "framework_rationale_missing",
      message: "high_quality 要求写清框架选用/裁剪理由，禁止仅按热点词机械匹配",
    });
  }
  if (!/critical|关键|优先|权重|主干/.test(logic) && units.length >= 3) {
    issues.push({
      severity: "error",
      code: "critical_weight_unspecified",
      message: "high_quality：多单元时须标明 critical/优先单元，避免同等优先失焦",
    });
  }
  const mas = Array.isArray(data?.method_applications) ? data.method_applications : [];
  for (const unit of units) {
    const unitId = String(unit?.id || "");
    for (const cap of ["judgment_structure", "evidence", "adjudication"] as const) {
      if (!mas.some((item: any) =>
        String(item?.capability_type) === cap
        && asList(item?.target_judgment_unit_refs).includes(unitId),
      )) {
        issues.push({
          severity: "error",
          code: `ma_${cap}_missing_for_unit`,
          message: `high_quality 要求 ${unitId} 登记 ${cap} 能力的 MethodApplication`,
        });
      }
    }
  }
  const scopeBlob = [
    nonEmpty(data?.research_scope?.label),
    nonEmpty(data?.judgment_spine),
    logic,
    ...units.map((unit: any) => `${unit?.title || ""} ${unit?.question || ""}`),
  ].join("\n");
  if (/存储|DRAM|NAND|HBM|内存周期/.test(scopeBlob)) {
    const productHints = ["HBM", "DRAM", "NAND", "通用", "消费", "企业级"];
    const covered = productHints.filter((hint) =>
      units.some((unit: any) => `${unit?.title || ""}${unit?.question || ""}`.includes(hint)),
    );
    if (covered.length < 2) {
      issues.push({
        severity: "error",
        code: "memory_cycle_product_split",
        message: "存储周期类 high_quality 须在判断单元中显式区分至少两类产品线",
      });
    }
    const requiredProductSegments = [
      { id: "HBM", pattern: /HBM/i },
      { id: "通用DRAM", pattern: /通用\s*DRAM|非\s*HBM\s*DRAM/i },
      { id: "企业级NAND", pattern: /企业级[^。\n]{0,8}NAND|NAND[^。\n]{0,8}企业级/i },
      { id: "消费级NAND", pattern: /消费级[^。\n]{0,8}NAND|NAND[^。\n]{0,8}消费级/i },
    ].filter((segment) => segment.pattern.test(scopeBlob));
    const missingSegments = requiredProductSegments
      .filter((segment) => !units.some((unit: any) =>
        segment.pattern.test(`${unit?.title || ""} ${unit?.question || ""}`),
      ))
      .map((segment) => segment.id);
    if (missingSegments.length) {
      issues.push({
        severity: "error",
        code: "memory_cycle_required_segments_missing",
        message: `研究范围已明确要求分产品，但判断单元未覆盖：${missingSegments.join("、")}`,
      });
    }
  }
  requireDeterministicChecked(data, issues);
  return issues;
}

export function collectStage02ConsistencyIssues(data: any): Stage02ConsistencyIssue[] {
  const issues: Stage02ConsistencyIssue[] = [];
  normalizePathBindings(data);
  const logic = nonEmpty(data?.research_logic_markdown, data?.document_markdown);
  const yamlText = nonEmpty(data?.ontology_view_yaml);
  if (!logic || logic.length < 40) {
    issues.push({ severity: "error", code: "missing_research_logic", message: "缺少合格的研究逻辑正文（research_logic_markdown）" });
  }
  if (!yamlText || yamlText.length < 20) {
    issues.push({ severity: "error", code: "missing_ontology_view", message: "缺少合格的本体视图 YAML（ontology_view_yaml）" });
  }

  let parsed: any = null;
  if (yamlText) {
    try {
      parsed = YAML.parse(yamlText);
    } catch {
      issues.push({ severity: "error", code: "ontology_yaml_parse", message: "ontology_view_yaml 无法解析为 YAML" });
    }
  }

  const jsonUnitIds = new Set(asList((data?.judgment_units || []).map((unit: any) => unit?.id)));
  const jsonErIds = new Set(asList((data?.evidence_requirements || []).map((item: any) => item?.id)));
  const jsonVariableIds = new Set(asList((data?.variables || []).map((item: any) => item?.id)));
  const jsonPaths = Array.isArray(data?.paths) ? data.paths : [];
  const jsonPathById = new Map<string, any>(
    jsonPaths.map((path: any): [string, any] => [nonEmpty(path?.id), path]),
  );
  const seenPathIds = new Set<string>();
  for (const path of jsonPaths) {
    const pathId = nonEmpty(path?.id);
    if (!pathId) {
      issues.push({ severity: "error", code: "path_id_missing", message: "传导路径缺少稳定 ID" });
      continue;
    }
    if (seenPathIds.has(pathId)) {
      issues.push({ severity: "error", code: "path_id_duplicate", message: `传导路径 ID 重复：${pathId}` });
    }
    seenPathIds.add(pathId);
    const boundUnits = asList(path?.judgment_unit_ids);
    if (!boundUnits.length) {
      issues.push({
        severity: "error",
        code: "path_without_judgment_unit",
        message: `传导路径 ${pathId} 未显式挂接任何判断单元`,
      });
    }
    for (const unitId of boundUnits) {
      if (!jsonUnitIds.has(unitId)) {
        issues.push({
          severity: "error",
          code: "path_unknown_judgment_unit",
          message: `传导路径 ${pathId} 挂接了不存在的判断单元 ${unitId}`,
        });
      }
    }
    const boundVariables = asList(path?.variable_ids);
    if (!boundVariables.length) {
      issues.push({
        severity: "error",
        code: "path_without_variable",
        message: `传导路径 ${pathId} 未登记状态变量`,
      });
    }
    for (const variableId of boundVariables) {
      if (!jsonVariableIds.has(variableId)) {
        issues.push({
          severity: "error",
          code: "path_unknown_variable",
          message: `传导路径 ${pathId} 引用了不存在的状态变量 ${variableId}`,
        });
      }
    }
  }
  const propagationTypes = new Set(["transmission_path", "mechanism_validation", "impact_realization"]);
  for (const unit of Array.isArray(data?.judgment_units) ? data.judgment_units : []) {
    const unitId = nonEmpty(unit?.id);
    if (!propagationTypes.has(nonEmpty(unit?.judgment_type))) continue;
    const validPath = jsonPaths.some((path: any) =>
      asList(path?.judgment_unit_ids).includes(unitId)
      && asList(path?.variable_ids).length >= 2,
    );
    if (!validPath) {
      issues.push({
        severity: "error",
        code: "propagation_unit_without_bound_path",
        message: `传导/机制/影响判断 ${unitId} 未显式绑定含两个及以上状态变量的路径`,
      });
    }
  }

  if (parsed && typeof parsed === "object") {
    const yamlUnits = Array.isArray(parsed.judgment_units) ? parsed.judgment_units : [];
    const yamlUnitIds = new Set(asList(yamlUnits.map((unit: any) => unit?.id)));
    for (const id of jsonUnitIds) {
      if (!yamlUnitIds.has(id)) {
        issues.push({
          severity: "error",
          code: "unit_missing_in_yaml",
          message: `执行字段判断单元 ${id} 未出现在本体视图 YAML`,
        });
      }
    }
    for (const id of yamlUnitIds) {
      if (!jsonUnitIds.has(id)) {
        issues.push({
          severity: "error",
          code: "unit_missing_in_json",
          message: `本体视图 YAML 判断单元 ${id} 未出现在执行字段`,
        });
      }
    }
    const yamlErs = Array.isArray(parsed.evidence_requirements) ? parsed.evidence_requirements : [];
    if (yamlErs.length && jsonErIds.size) {
      const yamlErIds = new Set(asList(yamlErs.map((item: any) => item?.id)));
      for (const id of jsonErIds) {
        if (!yamlErIds.has(id)) {
          issues.push({
            severity: "warning",
            code: "er_missing_in_yaml",
            message: `证据要求 ${id} 未同步到本体视图 YAML`,
          });
        }
      }
    }
    const yamlPaths = Array.isArray(parsed.path_design) ? parsed.path_design : [];
    const yamlPathById = new Map<string, any>(
      yamlPaths.map((path: any): [string, any] => [nonEmpty(path?.id || path?.path_id), path]),
    );
    for (const [pathId, path] of jsonPathById) {
      if (!pathId) continue;
      const yamlPath = yamlPathById.get(pathId);
      if (!yamlPath) {
        issues.push({
          severity: "error",
          code: "path_missing_in_yaml",
          message: `执行字段传导路径 ${pathId} 未出现在本体视图 YAML`,
        });
        continue;
      }
      const jsonUnits = asList(path?.judgment_unit_ids).sort();
      const yamlUnits = asList(
        yamlPath?.judgment_unit_ids
        || yamlPath?.linked_judgment_units
        || yamlPath?.judgment_unit_refs,
      ).sort();
      if (jsonUnits.join("\u0000") !== yamlUnits.join("\u0000")) {
        issues.push({
          severity: "error",
          code: "path_binding_mismatch",
          message: `传导路径 ${pathId} 的判断单元绑定在执行字段与本体视图 YAML 中不一致`,
        });
      }
    }
    for (const pathId of yamlPathById.keys()) {
      if (pathId && !jsonPathById.has(pathId)) {
        issues.push({
          severity: "error",
          code: "path_missing_in_json",
          message: `本体视图 YAML 传导路径 ${pathId} 未出现在执行字段`,
        });
      }
    }
    const qc = parsed.quality_control || {};
    const yamlCanEnter = qc.can_enter_03;
    if (yamlCanEnter != null && Boolean(yamlCanEnter) !== Boolean(data?.can_enter_03)) {
      issues.push({
        severity: "error",
        code: "can_enter_03_mismatch",
        message: "执行字段 can_enter_03 与本体视图 quality_control.can_enter_03 不一致",
      });
    }
    const viewRef = nonEmpty(parsed?.task_context?.ontology_view_ref || parsed?.ontology_view_ref);
    if (viewRef && nonEmpty(data?.ontology_view_ref) && viewRef !== nonEmpty(data?.ontology_view_ref)) {
      issues.push({
        severity: "warning",
        code: "ontology_view_ref_mismatch",
        message: "ontology_view_ref 与 YAML task_context 不一致",
      });
    }
  }

  if (!nonEmpty(data?.judgment_spine)) {
    issues.push({ severity: "error", code: "missing_judgment_spine", message: "缺少 judgment_spine（核心待验证命题）" });
  }

  // 存储周期类任务：须有分产品/分路径判断单元，避免行业均值叙事。
  const scopeBlob = [
    nonEmpty(data?.research_scope?.label),
    nonEmpty(data?.judgment_spine),
    nonEmpty(data?.research_logic_markdown, data?.document_markdown),
    ...(Array.isArray(data?.judgment_units) ? data.judgment_units : []).map((unit: any) =>
      `${unit?.title || ""} ${unit?.question || ""}`),
  ].join("\n");
  const memoryCycleTask = /存储|DRAM|NAND|HBM|内存周期/.test(scopeBlob);
  if (memoryCycleTask) {
    const units = Array.isArray(data?.judgment_units) ? data.judgment_units : [];
    const productHints = ["HBM", "DRAM", "NAND", "通用", "消费", "企业级"];
    const covered = productHints.filter((hint) =>
      units.some((unit: any) => `${unit?.title || ""}${unit?.question || ""}`.includes(hint))
      || scopeBlob.includes(hint),
    );
    if (units.length < 2) {
      issues.push({
        severity: nonEmpty(data?.quality_status) === "high_quality_pass" ? "error" : "warning",
        code: "memory_cycle_units_thin",
        message: "存储周期类任务须至少拆出 2 个判断单元（分产品/分路径），禁止单一行业均值单元",
      });
    } else if (covered.length < 2) {
      issues.push({
        severity: "warning",
        code: "memory_cycle_product_split",
        message: "存储周期类任务建议在判断单元中显式区分 HBM/通用 DRAM/NAND 等产品线",
      });
    }
  }

  const gapStatus = nonEmpty(data?.ontology_gap_scan_status);
  if (gapStatus === "blocking_gap" && data?.can_enter_03) {
    issues.push({
      severity: "error",
      code: "blocking_gap_can_enter",
      message: "ontology_gap_scan_status=blocking_gap 时 can_enter_03 不得为 true",
    });
  }
  if (data?.can_enter_03 !== true) {
    issues.push({
      severity: "error",
      code: "cannot_enter_03",
      message: "can_enter_03 必须为 true 才能确认进入 03",
    });
  }
  const quality = nonEmpty(data?.quality_status);
  if (quality !== "high_quality_pass") {
    issues.push({
      severity: "error",
      code: "quality_status",
      message: "本稿尚未达到可交接密度，请重新生成后再确认",
    });
  }
  issues.push(...applyHighQualityGate(collectStage02HighQualityIssues(data), quality));
  return issues;
}

export function assertStage02ReadyForApproval(data: any) {
  const errors = collectStage02ConsistencyIssues(data).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(`Stage02 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}

/**
 * 02 的局部结构必须可追溯回已确认的 01，而不是只在自身内部“结构完整”。
 * 此门禁不自动猜测假设与 JU 的语义映射：漏映射就要求重做 02。
 */
export function assertStage02AnswersStage01(data: any, taskDefinition: any): void {
  const contract = data?.task_answer_contract || {};
  const normalizedQuestion = nonEmpty(taskDefinition?.normalized_question);
  if (normalizedQuestion && nonEmpty(contract?.root_question) !== normalizedQuestion) {
    throw new Error("Stage02 根问题闭环失败：task_answer_contract.root_question 必须原样承接 Stage01 normalized_question");
  }

  const hypothesisIds = asList(
    (Array.isArray(taskDefinition?.hypotheses_to_verify)
      ? taskDefinition.hypotheses_to_verify
      : []).map((item: any) => item?.id),
  );
  const knownUnitIds = new Set(
    (Array.isArray(data?.judgment_units) ? data.judgment_units : [])
      .map((unit: any) => nonEmpty(unit?.id))
      .filter(Boolean),
  );
  const coverage = Array.isArray(contract?.hypothesis_coverage)
    ? contract.hypothesis_coverage
    : [];
  const coverageByHypothesis = new Map<string, string[]>(
    coverage.map((item: any) => [
      nonEmpty(item?.hypothesis_ref),
      asList(item?.judgment_unit_ids),
    ]),
  );
  const missing = hypothesisIds.filter((hypothesisId) => {
    const unitIds = coverageByHypothesis.get(hypothesisId) || [];
    return !unitIds.length || unitIds.some((unitId) => !knownUnitIds.has(unitId));
  });
  if (missing.length) {
    throw new Error(`Stage02 根问题闭环失败：Stage01 待验证假设未被有效 JudgmentUnit 承接：${missing.join(", ")}`);
  }
  const unknownHypotheses = [...coverageByHypothesis.keys()]
    .filter((hypothesisId) => hypothesisId && !hypothesisIds.includes(hypothesisId));
  if (unknownHypotheses.length) {
    throw new Error(`Stage02 根问题闭环失败：hypothesis_coverage 引用了 Stage01 不存在的假设：${unknownHypotheses.join(", ")}`);
  }
}
