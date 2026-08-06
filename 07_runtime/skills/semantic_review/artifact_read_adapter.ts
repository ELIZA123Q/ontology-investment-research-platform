/**
 * 历史 artifact 只读适配器。
 * - 读取时把旧字段名映射为 Public Contract 1.3 canonical 形状
 * - 写入路径应调用 stripLegacyWriteFields，禁止旧字段回写
 */

export type CanonicalClaim = {
  id: string;
  judgment_id: string;
  statement: string;
  strength: string;
  evidence_refs: string[];
  method_application_ids: string[];
  scope_ref: string;
};

export type CanonicalExpression = {
  id: string;
  claim_id: string;
  statement: string;
  judgment_ids: string[];
  method_application_ids: string[];
  evidence_draft_ids: string[];
  source_ids: string[];
};

const LEGACY_WRITE_FIELDS = [
  "expressions",
  "expression_audit",
  "admission",
  "admission_status",
  "claim_mode",
  "judgment_status",
  "reasoning_readiness",
  "path_gate_status",
  "path_status",
] as const;

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function asList(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/** 由 Judgment 确定性投影 Claim（C-nn），供 05 EX→C 审计使用。 */
export function projectClaimsFromJudgments(judgments: unknown): CanonicalClaim[] {
  return asList(judgments).map((judgment, index) => {
    const item = asRecord(judgment);
    const judgmentId = nonEmpty(item.id || item.judgment_id, `J-${index + 1}`);
    const evidenceRefs = [
      ...asList(item.supporting_evidence_draft_ids),
      ...asList(item.counter_evidence_draft_ids),
      ...asList(item.evidence_draft_ids),
      ...asList(item.evidence_refs),
    ].map(String).filter(Boolean);
    return {
      id: nonEmpty(item.claim_id, `C-${String(index + 1).padStart(2, "0")}`),
      judgment_id: judgmentId,
      statement: nonEmpty(item.conclusion || item.statement || item.title, judgmentId),
      strength: nonEmpty(item.strength || item.level, "J0"),
      evidence_refs: [...new Set(evidenceRefs)],
      method_application_ids: asList(item.method_application_ids).map(String).filter(Boolean),
      scope_ref: nonEmpty(item.scope_ref),
    };
  });
}

/** 将 stage05 report_claims（运行真源）投影为合同层 Expression。 */
export function projectExpressionsFromReportClaims(
  reportClaims: unknown,
  claims: CanonicalClaim[] = [],
): CanonicalExpression[] {
  const claimByJudgment = new Map(claims.map((claim) => [claim.judgment_id, claim]));
  return asList(reportClaims).map((raw, index) => {
    const claim = asRecord(raw);
    const judgmentIds = asList(claim.judgment_ids || claim.judgment_refs).map(String).filter(Boolean);
    const primaryJudgment = judgmentIds[0] || "";
    const mappedClaim = claimByJudgment.get(primaryJudgment);
    return {
      id: nonEmpty(claim.expression_id, `EX-${String(index + 1).padStart(2, "0")}`),
      claim_id: nonEmpty(claim.claim_id || mappedClaim?.id || claim.id),
      statement: nonEmpty(claim.statement || claim.text || claim.content || claim.body),
      judgment_ids: judgmentIds,
      method_application_ids: asList(claim.method_application_ids).map(String).filter(Boolean),
      evidence_draft_ids: asList(claim.evidence_draft_ids || claim.evidence_refs).map(String).filter(Boolean),
      source_ids: asList(claim.source_ids || claim.source_refs).map(String).filter(Boolean),
    };
  });
}

/** 规范化 JudgmentUnit：补齐规范可选字段，保留历史 id。 */
export function normalizeJudgmentUnit(raw: unknown, index = 0): Record<string, any> {
  const unit = asRecord(raw);
  const id = nonEmpty(unit.id || unit.judgment_unit_id, `JU-${index + 1}`);
  return {
    ...unit,
    id,
    judgment_unit_id: id,
    title: nonEmpty(unit.title || unit.statement || unit.question, `关键判断 ${index + 1}`),
    question: nonEmpty(unit.question || unit.statement || unit.title),
    judgment_type: nonEmpty(unit.judgment_type, "mechanism_validation"),
    scope_ref: nonEmpty(unit.scope_ref),
    ontology_node_ids: asList(unit.ontology_node_ids).map(String),
    linked_paths: asList(unit.linked_paths || unit.path_ids || unit.path_refs).map(String).filter(Boolean),
    evidence_requirements: asList(unit.evidence_requirements).map((item) => (
      typeof item === "string" ? item : nonEmpty(asRecord(item).requirement || asRecord(item).statement)
    )).filter(Boolean),
    candidate_claim: nonEmpty(unit.candidate_claim || unit.title || unit.question),
    content_hash: nonEmpty(unit.content_hash),
    priority_tier: nonEmpty(unit.priority_tier, index === 0 ? "critical" : "important"),
    decision_weight: typeof unit.decision_weight === "number" ? unit.decision_weight : (index === 0 ? 1 : 0.5),
    decision_role: nonEmpty(unit.decision_role, index === 0 ? "primary" : "supporting"),
  };
}

/** 规范化 Stage02 路径；旧正式视图字段只做只读别名映射，不猜测语义归属。 */
export function normalizeStructurePath(raw: unknown, index = 0): Record<string, any> {
  const path = asRecord(raw);
  return {
    ...path,
    id: nonEmpty(path.id || path.path_id, `PATH-${index + 1}`),
    statement: nonEmpty(path.statement || path.description || path.name, `传导路径 ${index + 1}`),
    variable_ids: asList(path.variable_ids || path.state_variable_refs).map(String).filter(Boolean),
    judgment_unit_ids: asList(
      path.judgment_unit_ids
      || path.linked_judgment_units
      || path.judgment_unit_refs,
    ).map(String).filter(Boolean),
  };
}

/** 规范化 Judgment：统一 judgment_unit_id 与证据引用别名。 */
export function normalizeJudgment(raw: unknown, index = 0): Record<string, any> {
  const judgment = asRecord(raw);
  const id = nonEmpty(judgment.id || judgment.judgment_id, `J-${index + 1}`);
  const supporting = [
    ...asList(judgment.supporting_evidence_draft_ids),
    ...asList(judgment.evidence_draft_ids),
    ...asList(judgment.evidence_refs),
  ].map(String).filter(Boolean);
  return {
    ...judgment,
    id,
    judgment_unit_id: nonEmpty(
      judgment.judgment_unit_id || judgment.judgment_unit_ref || judgment.unit_id,
      `JU-${index + 1}`,
    ),
    strength: nonEmpty(judgment.strength || judgment.level || judgment.judgment_level, "J0"),
    supporting_evidence_draft_ids: [...new Set(supporting)],
    counter_evidence_draft_ids: asList(judgment.counter_evidence_draft_ids).map(String).filter(Boolean),
  };
}

/**
 * 只读规范化任意阶段 artifact JSON。
 * 不改变持久化内容；页面与审计应优先消费返回值。
 */
export function adaptArtifactForRead(kind: string, raw: unknown): Record<string, any> {
  const data = { ...asRecord(raw) };

  if (kind === "stage_02" || kind === "stage02") {
    data.judgment_units = asList(data.judgment_units).map((unit, index) => normalizeJudgmentUnit(unit, index));
    const unitIdsByPath = new Map<string, string[]>();
    for (const unit of data.judgment_units) {
      for (const pathId of asList(unit.linked_paths).map(String)) {
        const ids = unitIdsByPath.get(pathId) || [];
        if (!ids.includes(unit.id)) ids.push(unit.id);
        unitIdsByPath.set(pathId, ids);
      }
    }
    data.paths = asList(data.paths).map((path, index) => {
      const normalized = normalizeStructurePath(path, index);
      normalized.judgment_unit_ids = [
        ...new Set([
          ...normalized.judgment_unit_ids,
          ...(unitIdsByPath.get(normalized.id) || []),
        ]),
      ];
      return normalized;
    });
    return data;
  }

  if (kind === "stage_04" || kind === "stage04") {
    data.judgments = asList(data.judgments).map((item, index) => normalizeJudgment(item, index));
    const existingClaims = asList(data.claims);
    data.claims = existingClaims.length
      ? existingClaims.map((claim, index) => {
        const item = asRecord(claim);
        return {
          id: nonEmpty(item.id || item.claim_id, `C-${String(index + 1).padStart(2, "0")}`),
          judgment_id: nonEmpty(item.judgment_id || item.judgment_ref),
          statement: nonEmpty(item.statement || item.text),
          strength: nonEmpty(item.strength || item.level, "J0"),
          evidence_refs: asList(item.evidence_refs || item.evidence_draft_ids).map(String).filter(Boolean),
          method_application_ids: asList(item.method_application_ids).map(String).filter(Boolean),
          scope_ref: nonEmpty(item.scope_ref),
        } satisfies CanonicalClaim;
      })
      : projectClaimsFromJudgments(data.judgments);
    if (!nonEmpty(data.primary_claim_id) && data.claims[0]) {
      data.primary_claim_id = data.claims[0].id;
    }
    return data;
  }

  if (kind === "stage_05" || kind === "stage05") {
    const reportClaims = asList(data.report_claims?.length ? data.report_claims : data.expressions);
    data.report_claims = reportClaims.map((item, index) => {
      const claim = asRecord(item);
      return {
        id: nonEmpty(claim.id || claim.expression_id, `RC-${index + 1}`),
        statement: nonEmpty(claim.statement || claim.text || claim.content || claim.body),
        judgment_ids: asList(claim.judgment_ids || claim.judgment_refs).map(String).filter(Boolean),
        method_application_ids: asList(claim.method_application_ids).map(String).filter(Boolean),
        evidence_draft_ids: asList(claim.evidence_draft_ids || claim.evidence_refs).map(String).filter(Boolean),
        source_ids: asList(claim.source_ids || claim.source_refs).map(String).filter(Boolean),
      };
    });
    // 合同层别名：expressions 仅用于只读审计，不进入正式 schema 写入。
    data.expressions = projectExpressionsFromReportClaims(data.report_claims);
    return data;
  }

  return data;
}

/** 写入前剥离合同外/遗留旁路字段，防止旧字段进入新产物。 */
export function stripLegacyWriteFields(data: unknown): Record<string, any> {
  const next = { ...asRecord(data) };
  for (const field of LEGACY_WRITE_FIELDS) {
    delete next[field];
  }
  return next;
}

/** 供 05 审计：把 report_claims 转成 auditStage05Expressions 可识别的形状。 */
export function toExpressionAuditInputs(stage05: unknown, stage04: unknown): {
  expressions: Array<Record<string, any>>;
  claims: CanonicalClaim[];
  judgments: any[];
} {
  const adapted04 = adaptArtifactForRead("stage_04", stage04);
  const adapted05 = adaptArtifactForRead("stage_05", stage05);
  const claims = asList(adapted04.claims) as CanonicalClaim[];
  const expressions = projectExpressionsFromReportClaims(adapted05.report_claims, claims).map((item) => ({
    id: item.id,
    expression_id: item.id,
    claim_id: item.claim_id,
    text: item.statement,
    body: item.statement,
    content: item.statement,
    judgment_ids: item.judgment_ids,
  }));
  return {
    expressions,
    claims,
    judgments: asList(adapted04.judgments),
  };
}
