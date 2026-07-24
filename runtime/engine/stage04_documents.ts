/** Stage04 双产物（判断简报.md + 推理审计.yaml）与确认门禁。 */

import YAML from "yaml";

export const STAGE04_QUALITY_GATE_REF =
  "workflow/stages/04_判断/04_推理输出规范.md#6-质量门槛与返工";

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function projectReasoningAuditYaml(
  data: any,
  options: { taskId?: string; question?: string } = {},
): string {
  const judgments = Array.isArray(data?.judgments) ? data.judgments : [];
  const primary = judgments[0];
  const levels = judgments.map((item: any) => String(item?.strength || "J0"));
  const maxLevel = ["J4", "J3", "J2", "J1", "J0"].find((level) => levels.includes(level)) || "J0";
  const payload = {
    document_type: "reasoning_audit",
    schema_version: "5.0.0",
    metadata: {
      task_id: nonEmpty(options.taskId, "JTASK-RUNTIME"),
      audit_ref: nonEmpty(data?.audit_ref, "04-推理审计.yaml"),
      brief_ref: nonEmpty(data?.brief_ref, "04-判断简报.md"),
      stage_status: nonEmpty(data?.stage_status, "complete"),
      quality_status: nonEmpty(data?.quality_status, "minimum_pass"),
      quality_gate_ref: nonEmpty(data?.quality_gate_ref, STAGE04_QUALITY_GATE_REF),
      deterministic_check_status: nonEmpty(data?.deterministic_check_status, "not_checked"),
      semantic_review_status: nonEmpty(data?.semantic_review_status, "not_reviewed"),
      judgment_as_of: nonEmpty(data?.judgment_as_of, primary?.cutoff_at),
      normalized_question: nonEmpty(options.question),
    },
    overall_judgment: {
      primary_claim_id: nonEmpty(data?.primary_claim_id, primary?.id || "J-PRIMARY"),
      judgment_level: nonEmpty(data?.judgment_level, maxLevel),
      confidence: nonEmpty(data?.confidence, primary?.confidence || "low"),
      overall_boundary: nonEmpty(data?.overall_boundary),
    },
    judgment_unit_gate_results: judgments.map((item: any) => ({
      judgment_id: nonEmpty(item?.id),
      judgment_unit_id: nonEmpty(item?.judgment_unit_id),
      strength: nonEmpty(item?.strength),
      decision_status: nonEmpty(item?.decision_status),
      conclusion: nonEmpty(item?.conclusion),
    })),
    claim_register: judgments.map((item: any, index: number) => ({
      claim_id: `C-${String(index + 1).padStart(2, "0")}`,
      judgment_id: nonEmpty(item?.id),
      statement: nonEmpty(item?.conclusion),
      strength: nonEmpty(item?.strength),
    })),
    uncertainty_register: judgments.flatMap((item: any) => asList(item?.uncertainties).map((text, index) => ({
      uncertainty_id: `${item.id}-U${index + 1}`,
      statement: text,
      judgment_id: nonEmpty(item?.id),
    }))),
    change_gate_register: judgments.flatMap((item: any) => asList(item?.invalidation_conditions).map((text, index) => ({
      change_gate_id: `RC-${nonEmpty(item?.id)}-${index + 1}`,
      statement: text,
      judgment_id: nonEmpty(item?.id),
    }))),
    handoff_to_05: {
      allowed_core_claims: judgments.filter((item: any) => item?.strength !== "J0").map((item: any) => item.id),
      restricted_claims: judgments.filter((item: any) => item?.strength === "J0").map((item: any) => item.id),
      overall_boundary: nonEmpty(data?.overall_boundary),
    },
    brief_quality_check: {
      result: nonEmpty(data?.brief_quality_check_result, "pass"),
    },
    compliance_check: {
      no_trading_advice: true,
    },
  };
  return YAML.stringify(payload);
}

export function ensureStage04DocumentFields(
  data: any,
  options: { question?: string; taskId?: string } = {},
): any {
  const next = data && typeof data === "object" ? data : {};
  const judgments = Array.isArray(next.judgments) ? next.judgments : [];
  const primary = judgments[0];
  const levels = judgments.map((item: any) => String(item?.strength || "J0"));
  const maxLevel = ["J4", "J3", "J2", "J1", "J0"].find((level) => levels.includes(level)) || "J0";

  next.stage_status = nonEmpty(next.stage_status, "complete");
  next.quality_gate_ref = nonEmpty(next.quality_gate_ref, STAGE04_QUALITY_GATE_REF);
  next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  next.semantic_review_status = nonEmpty(next.semantic_review_status, "not_reviewed");
  next.confidence = nonEmpty(next.confidence, primary?.confidence || "low");
  next.judgment_level = nonEmpty(next.judgment_level, maxLevel);
  next.primary_claim_id = nonEmpty(next.primary_claim_id, primary?.id || "J-PRIMARY");
  next.audit_ref = nonEmpty(next.audit_ref, "04-推理审计.yaml");
  next.brief_ref = nonEmpty(next.brief_ref, "04-判断简报.md");
  next.brief_quality_check_result = nonEmpty(next.brief_quality_check_result, "pass");
  next.judgment_as_of = nonEmpty(next.judgment_as_of, primary?.cutoff_at || new Date().toISOString());
  next.quality_status = nonEmpty(
    next.quality_status,
    next.brief_quality_check_result === "pass" ? "minimum_pass" : "return_required",
  );

  const competing = Array.isArray(next.competing_explanations) ? next.competing_explanations : [];
  const activeCompeting = competing.filter((item: any) => String(item?.status || "active") !== "eliminated");
  next.object_differentiation = nonEmpty(
    next.object_differentiation,
    judgments.length > 1
      ? judgments.map((item: any) => `${item.title || item.id}：${item.conclusion || ""}`).join("；")
      : (primary ? `${primary.title || primary.id}：${primary.conclusion || ""}` : "尚未形成对象分化。"),
  );
  next.primary_path_ruling = nonEmpty(
    next.primary_path_ruling,
    primary
      ? `主路径采纳「${primary.conclusion || primary.title || primary.id}」；活跃竞争解释 ${activeCompeting.length} 条。`
      : "尚未形成主路径裁决。",
  );
  next.investment_proposition = nonEmpty(
    next.investment_proposition,
    primary
      ? `投资命题：${primary.conclusion || "暂不可判断"}；改判看：${asList(primary?.invalidation_conditions).slice(0, 3).join("；") || "未登记"}。`
      : "暂无投资命题。",
  );
  if (!next.expression_permission || typeof next.expression_permission !== "object") {
    next.expression_permission = {};
  }
  next.expression_permission.allowed_core_claims = asList(
    next.expression_permission.allowed_core_claims?.length
      ? next.expression_permission.allowed_core_claims
      : judgments.filter((item: any) => item?.strength !== "J0").map((item: any) => item.id),
  );
  next.expression_permission.restricted_claims = asList(
    next.expression_permission.restricted_claims?.length
      ? next.expression_permission.restricted_claims
      : judgments.filter((item: any) => item?.strength === "J0").map((item: any) => item.id),
  );
  next.expression_permission.max_expression_level = nonEmpty(
    next.expression_permission.max_expression_level,
    maxLevel,
  );
  next.expression_permission.notes = nonEmpty(
    next.expression_permission.notes,
    "05 不得抬高强度，不得新增事实；仅复述本简报已许可主张。",
  );

  const brief = nonEmpty(next.judgment_brief_markdown, nonEmpty(next.document_markdown));
  if (brief) next.judgment_brief_markdown = brief;
  if (!nonEmpty(next.reasoning_audit_yaml)) {
    next.reasoning_audit_yaml = projectReasoningAuditYaml(next, options);
  }
  if (nonEmpty(next.judgment_brief_markdown)) {
    next.document_markdown = next.judgment_brief_markdown;
  }
  return next;
}

export type Stage04ConsistencyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export function collectStage04ConsistencyIssues(data: any): Stage04ConsistencyIssue[] {
  const issues: Stage04ConsistencyIssue[] = [];
  const brief = nonEmpty(data?.judgment_brief_markdown, data?.document_markdown);
  const audit = nonEmpty(data?.reasoning_audit_yaml);
  if (!brief || brief.length < 40) {
    issues.push({ severity: "error", code: "missing_brief", message: "缺少合格的判断简报正文" });
  }
  if (!audit || audit.length < 20) {
    issues.push({ severity: "error", code: "missing_audit", message: "缺少推理审计 YAML" });
  }
  if (brief && nonEmpty(data?.document_markdown) && brief.trim() !== String(data.document_markdown).trim()) {
    issues.push({ severity: "error", code: "brief_mirror", message: "document_markdown 必须与 judgment_brief_markdown 一致" });
  }
  let parsed: any = null;
  if (audit) {
    try { parsed = YAML.parse(audit); } catch {
      issues.push({ severity: "error", code: "audit_parse", message: "reasoning_audit_yaml 无法解析" });
    }
  }
  const jsonIds = new Set(asList((data?.judgments || []).map((item: any) => item?.id)));
  if (parsed?.judgment_unit_gate_results) {
    const auditIds = new Set(asList(parsed.judgment_unit_gate_results.map((item: any) => item?.judgment_id)));
    for (const id of jsonIds) {
      if (!auditIds.has(id)) {
        issues.push({
          severity: "error",
          code: "judgment_missing_in_audit",
          message: `判断 ${id} 未出现在推理审计`,
        });
      }
    }
  }
  if (String(data?.brief_quality_check_result) !== "pass") {
    issues.push({ severity: "error", code: "brief_quality", message: "brief_quality_check_result 必须为 pass" });
  }
  const quality = nonEmpty(data?.quality_status);
  if (!["minimum_pass", "high_quality_pass"].includes(quality)) {
    issues.push({ severity: "error", code: "quality_status", message: "quality_status 须为 minimum_pass 或 high_quality_pass" });
  }
  if (!nonEmpty(data?.object_differentiation)) {
    issues.push({ severity: "warning", code: "missing_object_differentiation", message: "建议填写对象分化 object_differentiation" });
  }
  if (!nonEmpty(data?.primary_path_ruling)) {
    issues.push({ severity: "warning", code: "missing_primary_path_ruling", message: "建议填写主路径裁决 primary_path_ruling" });
  }
  if (!nonEmpty(data?.investment_proposition)) {
    issues.push({ severity: "warning", code: "missing_investment_proposition", message: "建议填写投资命题 investment_proposition" });
  }
  return issues;
}

export function assertStage04ReadyForApproval(data: any) {
  const errors = collectStage04ConsistencyIssues(data).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(`Stage04 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}
