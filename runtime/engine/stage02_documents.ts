/** Stage02 双产物（研究逻辑.md + 本体视图.yaml）同步与一致性门禁。 */

import YAML from "yaml";

export const STAGE02_QUALITY_GATE_REF =
  "workflow/stages/02_结构/02_判断结构与本体视图规范.md#7-质量门槛与返工规则";

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
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

  const logicFromAlias = nonEmpty(next.research_logic_markdown, nonEmpty(next.document_markdown));
  if (logicFromAlias) next.research_logic_markdown = logicFromAlias;
  if (!nonEmpty(next.ontology_view_yaml)) {
    next.ontology_view_yaml = projectOntologyViewYaml(next, options);
  }
  // 兼容旧 UI：document_markdown 始终镜像研究逻辑正文
  if (nonEmpty(next.research_logic_markdown)) {
    next.document_markdown = next.research_logic_markdown;
  }
  return next;
}

export type Stage02ConsistencyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

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
  if (!["minimum_pass", "high_quality_pass"].includes(quality)) {
    issues.push({
      severity: "error",
      code: "quality_status",
      message: "quality_status 须为 minimum_pass 或 high_quality_pass",
    });
  }
  return issues;
}

export function assertStage02ReadyForApproval(data: any) {
  const errors = collectStage02ConsistencyIssues(data).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(`Stage02 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}
