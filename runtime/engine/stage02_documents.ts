/** Stage02 双产物（研究逻辑.md + 本体视图.yaml）同步与一致性门禁。 */

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

export const STAGE02_QUALITY_GATE_REF =
  "workflow/stages/02_结构/02_判断结构与本体视图规范.md#7-质量门槛与返工规则";

function nonEmpty(value: unknown, fallback = ""): string {
  return nonEmptyText(value, fallback);
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function defaultOntologyViewRef(logicId = "RLOG-RUNTIME"): string {
  return `02-研究逻辑配对本体视图-${logicId}.yaml`;
}

/** 从执行字段投影最小可审阅本体视图 YAML（模型未给全文时的兜底）。 */
export function projectOntologyViewYaml(data: any, options: { taskId?: string; question?: string } = {}): string {
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
    schema_version: "2.1.0",
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
      evidence_requirements: asList(unit?.evidence_requirements),
    })),
    path_design: paths.map((path: any) => ({
      id: nonEmpty(path?.id),
      statement: nonEmpty(path?.statement),
      variable_ids: asList(path?.variable_ids),
    })),
    ontology_bindings: {
      variables: variables.map((variable: any) => ({
        id: nonEmpty(variable?.id),
        name: nonEmpty(variable?.name),
        ontology_node_id: nonEmpty(variable?.ontology_node_id),
        variable_kind: nonEmpty(variable?.variable_kind),
        anchors: asList(variable?.anchors),
      })),
    },
    evidence_requirements: evidenceRequirements.map((item: any) => ({
      id: nonEmpty(item?.id),
      requirement: nonEmpty(item?.requirement),
      evidence_role: nonEmpty(item?.evidence_role),
      judgment_unit_ids: asList(item?.judgment_unit_ids),
      minimum_independent_sources: Number(item?.minimum_independent_sources || 1),
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

  if (nonEmpty(next.quality_status) === "high_quality_pass") {
    const provisional = { ...next, deterministic_check_status: "checked" };
    const hqErrors = collectStage02HighQualityIssues(provisional);
    if (hqErrors.length) downgradeIfHighQualityFails(next, hqErrors);
    else next.deterministic_check_status = "checked";
  }
  return next;
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
  const counters = Array.isArray(data?.counter_evidence_directions) ? data.counter_evidence_directions : [];
  const substantiveCd = counters.filter((item: any) => nonEmpty(item?.statement).length >= 8);
  if (!substantiveCd.length) {
    issues.push({
      severity: "error",
      code: "counter_evidence_directions_thin",
      message: "high_quality 要求至少 1 条可执行的反证方向（非空 statement）",
    });
  }
  const ers = Array.isArray(data?.evidence_requirements) ? data.evidence_requirements : [];
  if (!ers.some((item: any) => String(item?.evidence_role) === "counter")) {
    issues.push({
      severity: "error",
      code: "counter_evidence_role_missing",
      message: "high_quality 要求 evidence_requirements 中至少有 1 条 counter 角色，区分主证与反证",
    });
  }
  if (!/停止条件/.test(logic)) {
    issues.push({
      severity: "error",
      code: "stop_condition_section_missing",
      message: "high_quality 要求研究逻辑写明「停止条件」（最低验证条件，而非材料越多越好）",
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
  for (const cap of ["judgment_structure", "evidence", "adjudication"] as const) {
    if (!mas.some((item: any) => String(item?.capability_type) === cap)) {
      issues.push({
        severity: "error",
        code: `ma_${cap}_missing`,
        message: `high_quality 要求登记 ${cap} 能力的 MethodApplication`,
      });
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
      units.some((unit: any) => `${unit?.title || ""}${unit?.question || ""}`.includes(hint))
      || scopeBlob.includes(hint),
    );
    if (covered.length < 2) {
      issues.push({
        severity: "error",
        code: "memory_cycle_product_split",
        message: "存储周期类 high_quality 须在判断单元中显式区分至少两类产品线",
      });
    }
  }
  requireDeterministicChecked(data, issues);
  return issues;
}

export function collectStage02ConsistencyIssues(data: any): Stage02ConsistencyIssue[] {
  const issues: Stage02ConsistencyIssue[] = [];
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
