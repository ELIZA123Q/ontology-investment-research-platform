/** Stage05 双产物（研究报告.md + 表达审计.yaml）与确认门禁。 */

import YAML from "yaml";
import {
  collectStage05HighQualityIssues,
  collectStage05StructureIssues,
  hasPublishableStage05Structure,
  isPlaceholderResearchEdge,
  looksLikeDeterministicSkeleton,
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

export function hasTradingAdviceOverreach(body: string): boolean {
  return /配置上|仓位建议|目标价|买入评级|卖出评级|投资者(?:需|应)|应警惕[^。；\n]{0,24}(?:公司|厂商|标的)|(?:估值|板块)[^。；\n]{0,32}(?:溢价|见顶风险)/.test(body);
}

function highQualityErrors(data: any) {
  const body = nonEmpty(data?.document_markdown);
  const errors = collectStage05HighQualityIssues({
    body,
    research_edge: Array.isArray(data?.research_edge) ? data.research_edge : [],
    deterministic_check_status: nonEmpty(data?.deterministic_check_status),
    from_skeleton: Boolean(data?.__from_skeleton) || looksLikeDeterministicSkeleton(nonEmpty(data?.document_markdown)),
  }).filter((item) => item.severity === "error");
  const review = data?.research_value_review;
  if (!review || String(review.status || "") !== "pass") {
    errors.push({
      severity: "error",
      code: "research_value_review_failed",
      message: "研究价值审查未通过：章节齐全、表格齐全不等于对研究员有用",
    });
  } else if (Number(review.total_score || 0) < Number(review.pass_threshold || 16)) {
    errors.push({
      severity: "error",
      code: "research_value_score_below_threshold",
      message: `研究价值得分 ${Number(review.total_score || 0)}/20，低于 ${Number(review.pass_threshold || 16)}/20`,
    });
  }
  if (hasTradingAdviceOverreach(body)) {
    errors.push({
      severity: "error",
      code: "trading_advice_overreach",
      message: "正文出现配置、评级、目标价、投资者行动或个股估值溢价式建议；行业研究含义不得越过 Stage04 表达许可",
    });
  }
  return errors;
}

export function projectExpressionAuditYaml(
  data: any,
  options: { taskId?: string; question?: string; stage04?: any } = {},
): string {
  const claims = Array.isArray(data?.report_claims) ? data.report_claims : [];
  const body = nonEmpty(data?.document_markdown);
  const tradingAdviceOverreach = hasTradingAdviceOverreach(body);
  const structureOk = hasPublishableStage05Structure(body);
  const hqErrors = highQualityErrors(data);
  const quality = nonEmpty(data?.quality_status, structureOk && !hqErrors.length ? "high_quality_pass" : "minimum_pass");
  const payload = {
    document_type: "expression_audit",
    schema_version: "1.0.0",
    metadata: {
      task_id: nonEmpty(options.taskId, "JTASK-RUNTIME"),
      stage_status: nonEmpty(data?.stage_status, "complete"),
      quality_status: quality,
      quality_gate_ref: nonEmpty(data?.quality_gate_ref, STAGE05_QUALITY_GATE_REF),
      deterministic_check_status: nonEmpty(data?.deterministic_check_status, "not_checked"),
      semantic_review_status: nonEmpty(data?.semantic_review_status, "not_reviewed"),
      source_04_brief_ref: nonEmpty(data?.source_04_brief_ref, options.stage04?.brief_ref || "04-判断简报.md"),
      source_04_audit_ref: nonEmpty(data?.source_04_audit_ref, options.stage04?.audit_ref || "04-推理审计.yaml"),
      delivery_ref: nonEmpty(data?.delivery_ref, "05-研究报告.md"),
      normalized_question: nonEmpty(options.question),
      note: "05 确认即完成 04→05 交付一致性检查；导出阶段仅复验当前批准版本、文件完整性与内容指纹。",
    },
    claim_expression_register: claims.map((claim: any, index: number) => {
      const judgmentIds = asList(claim?.judgment_ids);
      const stage04Claims = Array.isArray(options.stage04?.claims) ? options.stage04.claims : [];
      const mappedClaim = stage04Claims.find((item: any) => judgmentIds.includes(String(item?.judgment_id || "")))
        || stage04Claims[index];
      return {
        expression_id: `EX-${String(index + 1).padStart(2, "0")}`,
        // 表达审计登记的是 Stage05 report_claim，而不是其上游 Stage04 claim。
        // 上游 claim 只用于补充映射，不得覆盖当前交付物的主键。
        claim_id: nonEmpty(claim?.id || claim?.claim_id || mappedClaim?.id),
        statement: nonEmpty(claim?.statement),
        judgment_ids: judgmentIds,
        method_application_ids: asList(claim?.method_application_ids),
        evidence_draft_ids: asList(claim?.evidence_draft_ids),
        source_ids: asList(claim?.source_ids),
        intensity_lifted: false,
      };
    }),
    research_edge_check: {
      status: body.includes("市场认知差 / Research Edge") || body.includes("Research Edge")
        ? (Array.isArray(data?.research_edge) && data.research_edge.some((edge: any) => !isPlaceholderResearchEdge(edge))
          ? "substantive"
          : "present")
        : "missing",
    },
    structure_check: {
      publishable_shape: structureOk,
      high_quality_shape: hqErrors.length === 0,
    },
    research_value_review: data?.research_value_review || null,
    high_risk_section_coverage: {
      trading_advice: tradingAdviceOverreach ? "present" : "absent",
      price_target: "absent",
    },
    overall_check: {
      result: tradingAdviceOverreach || hqErrors.length ? "fail" : "pass",
      notes: "表达审计由执行字段投影；确认时校验 EX 与 report_claims 对齐、不抬强度、正文无高可见审计腔；high_quality 另验密度与 Research Edge。",
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

  // 从 04 继承表达许可摘要，供 05 分层展开（不抬升）。
  if (!next.expression_permission_summary && options.stage04?.expression_permission) {
    next.expression_permission_summary = options.stage04.expression_permission;
  }

  if (nonEmpty(next.document_markdown)) {
    next.document_markdown = stripInlineAuditDetails(next.document_markdown);
  }

  const structureOk = hasPublishableStage05Structure(nonEmpty(next.document_markdown));
  const requestedQuality = nonEmpty(next.quality_status);

  // 占位 research_edge 仅允许在 minimum 路径补结构；不得用于抬升 high_quality。
  if (!Array.isArray(next.research_edge) || !next.research_edge.length) {
    if (structureOk && requestedQuality !== "high_quality_pass") {
      next.research_edge = [{
        market_view: "见正文「市场认知差 / Research Edge」",
        differentiated_view: "见正文表格",
        falsifier: "见正文证伪列",
        evidence_boundary: "见正文证据边界列",
      }];
    }
  }

  // 结构达标且无 HQ 形态错误时，正式路径可标 high + checked；否则降档。
  const provisional = { ...next, deterministic_check_status: "checked" };
  const hqErrors = highQualityErrors(provisional);

  if (requestedQuality === "high_quality_pass") {
    if (!structureOk || hqErrors.length) {
      next.quality_status = "minimum_pass";
      next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
    } else {
      next.quality_status = "high_quality_pass";
      next.deterministic_check_status = "checked";
    }
  } else if (!requestedQuality) {
    if (structureOk && !hqErrors.length) {
      next.quality_status = "high_quality_pass";
      next.deterministic_check_status = "checked";
    } else {
      next.quality_status = "minimum_pass";
      next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
    }
  } else if (structureOk && requestedQuality === "minimum_pass") {
    next.quality_status = "minimum_pass";
    next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  } else {
    next.quality_status = requestedQuality;
    next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  }

  // skeleton / 占位 edge 强制不得 high
  if (
    looksLikeDeterministicSkeleton(nonEmpty(next.document_markdown))
    || (Array.isArray(next.research_edge) && next.research_edge.length
      && next.research_edge.every((edge: any) => isPlaceholderResearchEdge(edge)))
  ) {
    if (next.quality_status === "high_quality_pass") {
      next.quality_status = "minimum_pass";
      next.deterministic_check_status = "not_checked";
    }
  }

  if (!Array.isArray(next.argument_chapters) || !next.argument_chapters.length) {
    const body = nonEmpty(next.document_markdown);
    const headings = [...body.matchAll(/^##\s+([一二三四五]、.+)$/gm)].map((m) => m[1]);
    if (headings.length) next.argument_chapters = headings;
  }

  // 审计属于结构化字段的确定性投影。每次保存都重建可派生部分，避免
  // report_claim 改名/重排后，旧 Claim Register 仍“形式通过、链路失联”。
  // 若旧审计已标记 intensity_lifted=true，则保留该风险标记，不能借重建洗掉。
  const canonicalAudit = YAML.parse(projectExpressionAuditYaml(next, options));
  try {
    const existingAudit = YAML.parse(nonEmpty(next.expression_audit_yaml));
    const existingRegister = Array.isArray(existingAudit?.claim_expression_register)
      ? existingAudit.claim_expression_register
      : [];
    canonicalAudit.claim_expression_register = canonicalAudit.claim_expression_register.map((item: any) => {
      const matched = existingRegister.find((old: any) => {
        if (nonEmpty(old?.claim_id) === nonEmpty(item?.claim_id)) return true;
        const oldJudgments = asList(old?.judgment_ids).sort().join("|");
        const newJudgments = asList(item?.judgment_ids).sort().join("|");
        return Boolean(oldJudgments) && oldJudgments === newJudgments;
      });
      return matched?.intensity_lifted === true
        ? { ...item, intensity_lifted: true }
        : item;
    });
  } catch {
    // 空白或损坏的旧审计直接由当前结构化字段恢复。
  }
  next.expression_audit_yaml = YAML.stringify(canonicalAudit);
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
  if (quality !== "high_quality_pass") {
    issues.push({
      severity: "error",
      code: "quality_status",
      message: "本稿尚未达到可交接密度，请重新生成后再确认",
    });
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
    for (const item of highQualityErrors(data)) {
      issues.push({
        severity: "error",
        code: item.code,
        message: `high_quality_pass 要求：${item.message}`,
      });
    }
  } else {
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

/** 确认门禁：须 high_quality_pass；正式确认要求结构达标。 */
export function assertStage05ReadyForApproval(
  data: any,
  options: { requirePublishableStructure?: boolean } = {},
) {
  if (nonEmpty(data?.quality_status) !== "high_quality_pass") {
    throw new Error("本稿尚未达到可交接密度，请重新生成后再确认");
  }
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
    for (const item of highQualityErrors(data)) {
      if (!errors.some((existing) => existing.code === item.code)) {
        errors.push({ severity: "error", code: item.code, message: item.message });
      }
    }
  }
  if (errors.length) {
    throw new Error(`Stage05 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}
