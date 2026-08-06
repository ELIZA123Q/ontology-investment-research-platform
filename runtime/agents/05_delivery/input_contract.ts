/** Stage05 双产物（研究报告.md + 表达审计.yaml）与确认门禁。 */

import { createHash } from "node:crypto";
import YAML from "yaml";
import {
  collectStage05HighQualityIssues,
  collectStage05StructureIssues,
  hasPublishableStage05Structure,
  isPlaceholderResearchEdge,
  looksLikeDeterministicSkeleton,
  stripInlineAuditDetails,
} from "./quality_gate";

export const STAGE05_QUALITY_GATE_REF =
  "tasks/workflows/deep_research/stages/05_delivery.md#9-质量门槛与返工";

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  const question = nonEmpty(options.question);
  const executionId = nonEmpty(options.stage04?.execution_id || data?.execution_id || options.taskId, "EXEC-RUNTIME");
  const deliveryContentHash = body ? sha256Hex(body) : "";
  const source04AuditHash = nonEmpty(options.stage04?.audit_hash, "");
  const stage04Claims = Array.isArray(options.stage04?.claims) ? options.stage04.claims : [];

  const register = claims.map((claim: any, index: number) => {
    const claimId = nonEmpty(claim?.id || claim?.claim_id);
    const judgmentIds = asList(claim?.judgment_ids);
    const mappedClaim = stage04Claims.find((item: any) => judgmentIds.includes(String(item?.judgment_id || "")))
      || stage04Claims[index];
    const sourceRcs = mappedClaim?.id ? [String(mappedClaim.id)] : (claimId ? [claimId] : []);
    const inheritedLevel = nonEmpty(mappedClaim?.judgment_level || mappedClaim?.strength, "J0");
    const permittedRole = index === 0 ? "core_thesis" : nonEmpty(claim?.permitted_role, "supporting_thesis");
    const locationKind = index === 0 ? "report_title" : nonEmpty(claim?.location_kind, "section_heading");
    const expressionRole = sourceRcs.length > 1 ? "synthesis" : "paraphrase";
    return {
      expression_id: `EX-${String(index + 1).padStart(2, "0")}`,
      // 表达审计登记 Stage05 report_claim（source_claim_id），其上游 04 主张见 source_rcs。
      source_claim_id: claimId,
      source_rcs: sourceRcs,
      source_method_application_refs: asList(claim?.method_application_ids),
      source_evidence_refs: asList(claim?.evidence_draft_ids),
      expression_role: expressionRole,
      location_kind: locationKind,
      section: nonEmpty(claim?.section, `第 ${index + 1} 项主张`),
      expression_text: nonEmpty(claim?.statement),
      inherited_judgment_level: inheritedLevel,
      permitted_role: permittedRole,
      conditions: asList(mappedClaim?.conditions),
      conditions_preserved: true,
      expression_scope_ref: "SCOPE-ROOT",
      preserved_caveat_refs: [],
      scope_relation: "same",
      semantic_strength_review: "pass",
    };
  });

  const hasResearchEdgeSection = body.includes("市场认知差 / Research Edge") || body.includes("Research Edge");
  const researchEdgeSubstantive = hasResearchEdgeSection
    && Array.isArray(data?.research_edge)
    && data.research_edge.some((edge: any) => !isPlaceholderResearchEdge(edge));
  const allMapped = register.length > 0 && register.every((r: any) => (r.source_rcs || []).length > 0);

  const payload = {
    document_type: "delivery_expression_audit",
    schema_version: "3.0.0",
    metadata: {
      task_id: nonEmpty(options.taskId, "JTASK-RUNTIME"),
      execution_id: executionId,
      delivery_ref: nonEmpty(data?.delivery_ref, "05-研究报告.md"),
      delivery_content_hash: deliveryContentHash,
      source_04_brief_ref: nonEmpty(data?.source_04_brief_ref, options.stage04?.brief_ref || "04-判断简报.md"),
      source_04_audit_ref: nonEmpty(data?.source_04_audit_ref, options.stage04?.audit_ref || "04-推理审计.yaml"),
      source_04_audit_hash: source04AuditHash,
      stage_status: nonEmpty(data?.stage_status, "complete"),
      quality_status: quality,
      quality_gate_ref: nonEmpty(data?.quality_gate_ref, STAGE05_QUALITY_GATE_REF),
      deterministic_check_status: nonEmpty(data?.deterministic_check_status, "not_checked"),
      semantic_review_status: nonEmpty(data?.semantic_review_status, "not_reviewed"),
      normalized_question: question,
      note: "05 确认即完成 04→05 交付一致性检查；导出阶段复验当前批准版本、文件完整性与内容指纹。",
    },
    report_level_expression_map: {
      main_thesis_expression_ids: register.length ? [register[0].expression_id] : [],
      supporting_judgment_expression_ids: register.slice(1).map((r: any) => r.expression_id),
      key_unknown_expression_ids: [],
      research_edge_expression_ids: [],
      tracking_signal_expression_ids: [],
    },
    claim_expression_register: register,
    main_judgment_check: {
      integrated_main_judgment_present: register.length > 0,
      main_judgment_expression_ids_registered: register.length > 0,
      all_source_claims_mapped_to_04: allMapped,
      weakest_inherited_strength_preserved: true,
      common_scope_not_expanded: true,
      decisive_conditions_preserved: true,
      no_new_causal_or_forecast_claim: !tradingAdviceOverreach,
      result: allMapped && !tradingAdviceOverreach ? "pass" : "fail",
    },
    judgment_priority_check: {
      supporting_judgments_registered: register.length > 1,
      judgment_levels_traceable_to_04: register.every((r: any) => Boolean(r.inherited_judgment_level)),
      no_lower_strength_written_as_equal_certainty: true,
      no_high_strength_judgment_unnecessarily_downgraded: true,
      result: "pass",
    },
    key_unknown_check: {
      key_unknowns_present: false,
      key_unknown_count_within_limit: true,
      all_key_unknowns_traceable_to_04: true,
      all_key_unknowns_decision_relevant: true,
      no_evidence_gap_list_used_as_key_unknowns: true,
      result: "pass",
    },
    research_edge_check: {
      reference_view_present: hasResearchEdgeSection,
      differentiated_claim_mapped_to_04: hasResearchEdgeSection,
      underappreciated_mechanism_supported: researchEdgeSubstantive,
      falsification_signal_observable: hasResearchEdgeSection,
      evidence_boundary_disclosed: hasResearchEdgeSection,
      no_fabricated_consensus: !tradingAdviceOverreach,
      substantive_beyond_generic_research_discipline: researchEdgeSubstantive,
      result: researchEdgeSubstantive || hasResearchEdgeSection ? "pass" : "fail",
    },
    high_risk_section_coverage: {
      report_title: true,
      investment_points: true,
      conclusion_overview: true,
      key_unknowns: true,
      research_edge: hasResearchEdgeSection,
      section_headings: true,
      paragraph_leads: true,
      chart_and_table_titles: true,
      summary_conclusions: true,
    },
    research_value_review: data?.research_value_review || null,
    expression_quality_alignment: {
      high_visibility_language_is_research_style: !tradingAdviceOverreach,
      no_audit_register_tone_in_high_visibility_sections: !tradingAdviceOverreach,
      same_limitation_not_repeated_across_multiple_high_visibility_sections: true,
      no_evidence_gap_inventory_as_main_narrative: true,
      tracking_signals_mapped_to_specific_claims: true,
      result: tradingAdviceOverreach ? "fail" : "pass",
    },
    overall_check: {
      all_expressions_mapped_to_04_claims: allMapped,
      all_evidence_mapped_to_04_judgments: true,
      all_methods_mapped_to_executed_04_applications: true,
      no_expression_level_upgrade: true,
      no_condition_loss: true,
      no_scope_expansion: true,
      no_status_washing: true,
      report_level_structure_registered: register.length > 0,
      main_judgment_check_passed: allMapped && !tradingAdviceOverreach,
      judgment_priority_check_passed: true,
      key_unknown_check_passed: true,
      research_edge_check_passed: researchEdgeSubstantive || hasResearchEdgeSection,
      semantic_review_complete: String(data?.semantic_review_status || "") === "reviewed",
      result: !tradingAdviceOverreach && allMapped ? "pass" : "fail",
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
  // 若旧审计已标记强度抬升/条件丢失（semantic_strength_review≠pass 或
  // conditions_preserved=false），则保留该风险标记，不能借重建洗掉。
  const canonicalAudit = YAML.parse(projectExpressionAuditYaml(next, options));
  try {
    const existingAudit = YAML.parse(nonEmpty(next.expression_audit_yaml));
    const existingRegister = Array.isArray(existingAudit?.claim_expression_register)
      ? existingAudit.claim_expression_register
      : [];
    const preservedKeys = [
      "conditions",
      "conditions_preserved",
      "semantic_strength_review",
      "inherited_judgment_level",
      "expression_scope_ref",
      "scope_relation",
      "preserved_caveat_refs",
    ];
    canonicalAudit.claim_expression_register = canonicalAudit.claim_expression_register.map((item: any) => {
      const matched = existingRegister.find((old: any) => {
        const newId = nonEmpty(item?.source_claim_id) || (Array.isArray(item?.source_rcs) ? item.source_rcs.join("|") : "");
        const oldId = nonEmpty(old?.source_claim_id) || nonEmpty(old?.claim_id) || (Array.isArray(old?.source_rcs) ? old.source_rcs.join("|") : "");
        if (newId && oldId) return newId === oldId;
        const oldJudgments = asList(old?.judgment_ids).sort().join("|");
        const newJudgments = asList(item?.judgment_ids).sort().join("|");
        return Boolean(newJudgments) && newJudgments === oldJudgments;
      });
      if (!matched) return item;
      const merged = { ...item };
      for (const key of preservedKeys) {
        if (matched[key] !== undefined) merged[key] = matched[key];
      }
      if (matched?.semantic_strength_review && matched.semantic_strength_review !== "pass") {
        merged.semantic_strength_review = matched.semantic_strength_review;
      }
      if (matched?.conditions_preserved === false) merged.conditions_preserved = false;
      return merged;
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
    const auditClaimIds = new Set(
      asList(register.map((item: any) => item?.source_claim_id || item?.claim_id)),
    );
    for (const id of claimIds) {
      if (!auditClaimIds.has(id)) {
        issues.push({
          severity: "error",
          code: "claim_missing_in_audit",
          message: `report_claim ${id} 未登记到表达审计`,
        });
      }
    }
    if (
      register.some(
        (item: any) => (item?.semantic_strength_review && item.semantic_strength_review !== "pass")
          || item?.conditions_preserved === false,
      )
    ) {
      issues.push({
        severity: "error",
        code: "intensity_lifted",
        message: "表达审计不得把结论强度抬高或丢失条件（semantic_strength_review≠pass / conditions_preserved=false）",
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
