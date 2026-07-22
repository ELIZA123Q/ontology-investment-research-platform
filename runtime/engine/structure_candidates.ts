/** Stage02 竞争解释 / 反向证据：与本体 CompetingExplanation→JudgmentUnit 对齐的候选对象。 */

export type CompetingExplanationCandidate = {
  explanation_id: string;
  statement: string;
  judgment_unit_ids: string[];
  /** Ontology 3.0 必填：可区分主路径与该解释的证据要求（Stage02 登记，Stage04 裁决）。 */
  discriminating_evidence: string[];
};

export type CounterEvidenceDirectionCandidate = {
  direction_id: string;
  statement: string;
  judgment_unit_ids: string[];
};

export type EvidenceRequirementProjection = {
  id: string;
  requirement: string;
  evidence_role: "support" | "counter" | "context" | "boundary";
  minimum_independent_sources: number;
  judgment_unit_ids: string[];
  source: "unit_requirement" | "counter_direction";
  source_ref?: string;
};

function asUnitIds(value: unknown, allowed?: Set<string>): string[] {
  const raw = Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const unique = [...new Set(raw)];
  if (!allowed) return unique;
  return unique.filter((id) => allowed.has(id));
}

function statementOf(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return String(record.statement || record.explanation || record.text || "").trim();
  }
  return "";
}

function asNonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

/** 解析/补齐 Ontology CompetingExplanation.discriminating_evidence。 */
export function resolveDiscriminatingEvidence(
  item: unknown,
  options: {
    statement?: string;
    unitIds?: string[];
    unitEvidenceById?: Map<string, string[]>;
    evidenceRequirementById?: Map<string, string>;
  } = {},
): string[] {
  const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
  const direct = asNonEmptyStrings(record?.discriminating_evidence);
  if (direct.length) return direct;

  const requirementRefs = asNonEmptyStrings(record?.discriminating_evidence_requirements);
  if (requirementRefs.length) {
    const byId = options.evidenceRequirementById;
    const resolved = requirementRefs.map((ref) => byId?.get(ref) || ref).map((item) => item.trim()).filter(Boolean);
    if (resolved.length) return [...new Set(resolved)];
  }

  const unitIds = options.unitIds?.length
    ? options.unitIds
    : asUnitIds(record?.judgment_unit_ids);
  if (unitIds.length && options.unitEvidenceById) {
    const fromUnits = unitIds.flatMap((unitId) => options.unitEvidenceById!.get(unitId) || []);
    const unique = [...new Set(fromUnits.map((item) => item.trim()).filter(Boolean))];
    if (unique.length) return unique;
  }

  const statement = String(options.statement || record?.statement || "").trim();
  return statement
    ? [`需可区分「${statement}」与主判断路径的对照证据`]
    : ["需可区分主判断路径与该竞争解释的对照证据"];
}

export function normalizeCompetingExplanations(
  raw: unknown,
  options: {
    unitIds?: Iterable<string>;
    prefix?: string;
    unitEvidenceById?: Map<string, string[]>;
    evidenceRequirementById?: Map<string, string>;
  } = {},
): CompetingExplanationCandidate[] {
  const allowed = options.unitIds ? new Set([...options.unitIds].map(String)) : undefined;
  const prefix = options.prefix || "CE";
  const items = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const result: CompetingExplanationCandidate[] = [];
  items.forEach((item, index) => {
    const statement = statementOf(item);
    if (!statement) return;
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    let id = String(record?.explanation_id || record?.id || `${prefix}-${String(index + 1).padStart(2, "0")}`).trim();
    if (!id || seen.has(id)) id = `${prefix}-${String(index + 1).padStart(2, "0")}`;
    let n = 1;
    while (seen.has(id)) {
      id = `${prefix}-${String(index + 1).padStart(2, "0")}-${n}`;
      n += 1;
    }
    seen.add(id);
    const judgment_unit_ids = asUnitIds(record?.judgment_unit_ids, allowed);
    result.push({
      explanation_id: id,
      statement,
      judgment_unit_ids,
      discriminating_evidence: resolveDiscriminatingEvidence(item, {
        statement,
        unitIds: judgment_unit_ids,
        unitEvidenceById: options.unitEvidenceById,
        evidenceRequirementById: options.evidenceRequirementById,
      }),
    });
  });
  return result;
}

export function normalizeCounterEvidenceDirections(
  raw: unknown,
  options: { unitIds?: Iterable<string>; prefix?: string } = {},
): CounterEvidenceDirectionCandidate[] {
  const allowed = options.unitIds ? new Set([...options.unitIds].map(String)) : undefined;
  const prefix = options.prefix || "CD";
  const items = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const result: CounterEvidenceDirectionCandidate[] = [];
  items.forEach((item, index) => {
    const statement = statementOf(item);
    if (!statement) return;
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    let id = String(record?.direction_id || record?.id || `${prefix}-${String(index + 1).padStart(2, "0")}`).trim();
    if (!id || seen.has(id)) id = `${prefix}-${String(index + 1).padStart(2, "0")}`;
    let n = 1;
    while (seen.has(id)) {
      id = `${prefix}-${String(index + 1).padStart(2, "0")}-${n}`;
      n += 1;
    }
    seen.add(id);
    result.push({
      direction_id: id,
      statement,
      judgment_unit_ids: asUnitIds(record?.judgment_unit_ids, allowed),
    });
  });
  return result;
}

/** 从 JU 必要证据字符串 + 反向证据方向投影为本体 EvidenceRequirement。 */
export function projectEvidenceRequirementsFromStructure(input: {
  units: Array<{ id: string; evidence_requirements?: unknown[] }>;
  counter_evidence_directions?: unknown;
}): EvidenceRequirementProjection[] {
  const result: EvidenceRequirementProjection[] = [];
  const seen = new Set<string>();
  for (const unit of input.units || []) {
    const unitId = String(unit.id || "").trim();
    if (!unitId) continue;
    const requirements = Array.isArray(unit.evidence_requirements) ? unit.evidence_requirements : [];
    requirements.forEach((item, index) => {
      const requirement = String(item || "").trim();
      if (!requirement) return;
      let id = `ER-${unitId}-${String(index + 1).padStart(2, "0")}`;
      let n = 1;
      while (seen.has(id)) {
        id = `ER-${unitId}-${String(index + 1).padStart(2, "0")}-${n}`;
        n += 1;
      }
      seen.add(id);
      result.push({
        id,
        requirement,
        evidence_role: "support",
        minimum_independent_sources: 1,
        judgment_unit_ids: [unitId],
        source: "unit_requirement",
      });
    });
  }
  const counters = normalizeCounterEvidenceDirections(input.counter_evidence_directions, {
    unitIds: (input.units || []).map((unit) => String(unit.id || "")).filter(Boolean),
  });
  for (const counter of counters) {
    let id = `ER-${counter.direction_id}`;
    let n = 1;
    while (seen.has(id)) {
      id = `ER-${counter.direction_id}-${n}`;
      n += 1;
    }
    seen.add(id);
    result.push({
      id,
      requirement: counter.statement,
      evidence_role: "counter",
      minimum_independent_sources: 1,
      judgment_unit_ids: [...counter.judgment_unit_ids],
      source: "counter_direction",
      source_ref: counter.direction_id,
    });
  }
  return result;
}

/** Stage02 CE 中绑定到指定 JU 的候选；未绑定（待归属）不自动进入任何 JU。 */
export function competingExplanationsForUnit(
  candidates: CompetingExplanationCandidate[],
  unitId: string,
): CompetingExplanationCandidate[] {
  return candidates.filter((item) => item.judgment_unit_ids.includes(unitId));
}

export function formatCandidateBullet(item: {
  statement: string;
  judgment_unit_ids?: string[];
  discriminating_evidence?: string[];
}): string {
  const units = item.judgment_unit_ids || [];
  const suffix = units.length ? `（挂接 ${units.join("、")}）` : "（待归属）";
  const discriminators = (item.discriminating_evidence || []).filter(Boolean);
  const discriminatorSuffix = discriminators.length
    ? `；区分证据：${discriminators.join("、")}`
    : "";
  return `${item.statement}${suffix}${discriminatorSuffix}`;
}
