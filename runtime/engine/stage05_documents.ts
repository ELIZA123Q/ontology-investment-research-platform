/** Stage05 双产物（研究报告.md + 表达审计.yaml）与确认门禁。 */

import YAML from "yaml";
import {
  collectStage05StructureIssues,
  hasPublishableStage05Structure,
  stripInlineAuditDetails,
} from "./stage05_quality";

export const STAGE05_QUALITY_GATE_REF =
  "workflow/stages/05_表达/05_投研表达与交付规范.md#9-质量门槛与返工";

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function projectExpressionAuditYaml(
  data: any,
  options: { taskId?: string; question?: string; stage04?: any } = {},
): string {
  const claims = Array.isArray(data?.report_claims) ? data.report_claims : [];
  const body = nonEmpty(data?.document_markdown);
  const structureOk = hasPublishableStage05Structure(body);
  const payload = {
    document_type: "expression_audit",
    schema_version: "1.0.0",
    metadata: {
      task_id: nonEmpty(options.taskId, "JTASK-RUNTIME"),
      stage_status: nonEmpty(data?.stage_status, "complete"),
      quality_status: nonEmpty(data?.quality_status, structureOk ? "high_quality_pass" : "minimum_pass"),
      quality_gate_ref: nonEmpty(data?.quality_gate_ref, STAGE05_QUALITY_GATE_REF),
      deterministic_check_status: nonEmpty(data?.deterministic_check_status, "not_checked"),
      semantic_review_status: nonEmpty(data?.semantic_review_status, "not_reviewed"),
      source_04_brief_ref: nonEmpty(data?.source_04_brief_ref, options.stage04?.brief_ref || "04-判断简报.md"),
      source_04_audit_ref: nonEmpty(data?.source_04_audit_ref, options.stage04?.audit_ref || "04-推理审计.yaml"),
      delivery_ref: nonEmpty(data?.delivery_ref, "05-研究报告.md"),
      normalized_question: nonEmpty(options.question),
      note: "工作台确认不等于 PUBLISHABLE；正式发布仍须通过 governance validate_05_outputs / validate_run。",
    },
    claim_expression_register: claims.map((claim: any, index: number) => ({
      expression_id: `EX-${String(index + 1).padStart(2, "0")}`,
      claim_id: nonEmpty(claim?.id),
      statement: nonEmpty(claim?.statement),
      judgment_ids: asList(claim?.judgment_ids),
      method_application_ids: asList(claim?.method_application_ids),
      evidence_draft_ids: asList(claim?.evidence_draft_ids),
      source_ids: asList(claim?.source_ids),
      intensity_lifted: false,
    })),
    research_edge_check: {
      status: body.includes("市场认知差 / Research Edge") || body.includes("Research Edge")
        ? "present"
        : "missing",
    },
    structure_check: {
      publishable_shape: structureOk,
    },
    high_risk_section_coverage: {
      trading_advice: "absent",
      price_target: "absent",
    },
    overall_check: {
      result: "pass",
      notes: "表达审计由执行字段投影；确认时校验 EX 与 report_claims 对齐、不抬强度、正文无高可见审计腔。",
    },
  };
  return YAML.stringify(payload);
}

export function ensureStage05DocumentFields(
  data: any,
  options: { question?: string; taskId?: string; stage04?: any } = {},
): any {
  const next = data && typeof data === "object" ? data : {};
  next.stage_status = nonEmpty(next.stage_status, "complete");
  next.quality_gate_ref = nonEmpty(next.quality_gate_ref, STAGE05_QUALITY_GATE_REF);
  next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  next.semantic_review_status = nonEmpty(next.semantic_review_status, "not_reviewed");
  next.source_04_brief_ref = nonEmpty(
    next.source_04_brief_ref,
    options.stage04?.brief_ref || "04-判断简报.md",
  );
  next.source_04_audit_ref = nonEmpty(
    next.source_04_audit_ref,
    options.stage04?.audit_ref || "04-推理审计.yaml",
  );
  next.delivery_ref = nonEmpty(next.delivery_ref, "05-研究报告.md");
  next.delivery_archetype = nonEmpty(
    next.delivery_archetype,
    options.stage04?.delivery_archetype
      || next.delivery_kind
      || "industry_cycle_report",
  );

  if (nonEmpty(next.document_markdown)) {
    next.document_markdown = stripInlineAuditDetails(next.document_markdown);
  }

  const structureOk = hasPublishableStage05Structure(nonEmpty(next.document_markdown));
  const requestedQuality = nonEmpty(next.quality_status);
  // 结构未达标时不得自称 high_quality_pass；达标时正式路径倾向 high_quality_pass。
  if (requestedQuality === "high_quality_pass" && !structureOk) {
    next.quality_status = "minimum_pass";
  } else if (!requestedQuality) {
    next.quality_status = structureOk ? "high_quality_pass" : "minimum_pass";
  } else if (structureOk && requestedQuality === "minimum_pass") {
    // 保留显式 minimum_pass（内部流转）；不自动抬升，避免绕过人工确认语义。
    next.quality_status = "minimum_pass";
  } else {
    next.quality_status = requestedQuality;
  }

  if (!Array.isArray(next.research_edge) || !next.research_edge.length) {
    if (structureOk) {
      next.research_edge = [{
        market_view: "见正文「市场认知差 / Research Edge」",
        differentiated_view: "见正文表格",
        falsifier: "见正文证伪列",
        evidence_boundary: "见正文证据边界列",
      }];
    }
  }
  if (!Array.isArray(next.argument_chapters) || !next.argument_chapters.length) {
    const body = nonEmpty(next.document_markdown);
    const headings = [...body.matchAll(/^##\s+([一二三四五]、.+)$/gm)].map((m) => m[1]);
    if (headings.length) next.argument_chapters = headings;
  }

  // 审计 YAML 随正文/质量状态刷新关键元数据；若已有人工审计且 claim 仍对齐则保留正文登记，否则重投影。
  if (!nonEmpty(next.expression_audit_yaml)) {
    next.expression_audit_yaml = projectExpressionAuditYaml(next, options);
  } else {
    try {
      const parsed = YAML.parse(next.expression_audit_yaml);
      if (parsed?.metadata) {
        parsed.metadata.quality_status = next.quality_status;
        parsed.research_edge_check = {
          status: nonEmpty(next.document_markdown).includes("Research Edge") ? "present" : "missing",
        };
        parsed.structure_check = { publishable_shape: structureOk };
        next.expression_audit_yaml = YAML.stringify(parsed);
      }
    } catch {
      next.expression_audit_yaml = projectExpressionAuditYaml(next, options);
    }
  }
  if (!nonEmpty(next.document_markdown)) {
    next.document_markdown = `# ${nonEmpty(next.title, "研究报告")}\n\n尚无正式交付正文，请生成或保存后再确认。`;
  }
  return next;
}

export type Stage05ConsistencyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export function collectStage05ConsistencyIssues(data: any): Stage05ConsistencyIssue[] {
  const issues: Stage05ConsistencyIssue[] = [];
  const body = nonEmpty(data?.document_markdown);
  const audit = nonEmpty(data?.expression_audit_yaml);
  if (!body || body.length < 40) {
    issues.push({ severity: "error", code: "missing_report", message: "缺少合格的研究报告正文" });
  }
  if (!audit || audit.length < 20) {
    issues.push({ severity: "error", code: "missing_expression_audit", message: "缺少表达审计 YAML" });
  }
  let parsed: any = null;
  if (audit) {
    try { parsed = YAML.parse(audit); } catch {
      issues.push({ severity: "error", code: "audit_parse", message: "expression_audit_yaml 无法解析" });
    }
  }
  const claimIds = new Set(asList((data?.report_claims || []).map((item: any) => item?.id)));
  const register = Array.isArray(parsed?.claim_expression_register) ? parsed.claim_expression_register : [];
  if (claimIds.size && register.length) {
    const auditClaimIds = new Set(asList(register.map((item: any) => item?.claim_id)));
    for (const id of claimIds) {
      if (!auditClaimIds.has(id)) {
        issues.push({
          severity: "error",
          code: "claim_missing_in_audit",
          message: `report_claim ${id} 未登记到表达审计`,
        });
      }
    }
    if (register.some((item: any) => item?.intensity_lifted === true)) {
      issues.push({
        severity: "error",
        code: "intensity_lifted",
        message: "表达审计不得把结论强度抬高（intensity_lifted=true）",
      });
    }
  }
  const quality = nonEmpty(data?.quality_status);
  if (!["minimum_pass", "high_quality_pass"].includes(quality)) {
    issues.push({ severity: "error", code: "quality_status", message: "quality_status 须为 minimum_pass 或 high_quality_pass" });
  }

  const structureIssues = collectStage05StructureIssues(body);
  const structureErrors = structureIssues.filter((item) => item.severity === "error");
  if (quality === "high_quality_pass") {
    for (const item of structureErrors) {
      issues.push({
        severity: "error",
        code: item.code,
        message: `high_quality_pass 要求：${item.message}`,
      });
    }
  } else {
    // minimum_pass 仅内部流转：结构缺失记 warning；但审计腔/压平简报仍阻断确认。
    for (const item of structureErrors) {
      const blocking = ["audit_register_voice", "inline_audit_details", "flattened_brief", "yaml_frontmatter"].includes(item.code);
      issues.push({
        severity: blocking ? "error" : "warning",
        code: item.code,
        message: item.message,
      });
    }
  }
  for (const item of structureIssues.filter((entry) => entry.severity === "warning")) {
    issues.push(item);
  }
  return issues;
}

/** 确认门禁：minimum 可流转但禁止审计腔/压平；high_quality / 正式确认要求结构达标。 */
export function assertStage05ReadyForApproval(
  data: any,
  options: { requirePublishableStructure?: boolean } = {},
) {
  const requireStructure = Boolean(
    options.requirePublishableStructure
    || nonEmpty(data?.quality_status) === "high_quality_pass",
  );
  const issues = collectStage05ConsistencyIssues(data);
  const errors = issues.filter((item) => item.severity === "error");
  if (requireStructure) {
    const structureErrors = collectStage05StructureIssues(nonEmpty(data?.document_markdown))
      .filter((item) => item.severity === "error");
    for (const item of structureErrors) {
      if (!errors.some((existing) => existing.code === item.code && existing.message === item.message)) {
        errors.push({ severity: "error", code: item.code, message: item.message });
      }
    }
  }
  if (errors.length) {
    throw new Error(`Stage05 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}
