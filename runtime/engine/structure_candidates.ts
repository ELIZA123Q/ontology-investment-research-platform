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
  /** 受治理的领域取证画像；具体来源与查询参数不在本字段中。 */
  evidence_profile_refs?: string[];
  /** 与 JudgmentType 对齐的领域取证配方索引。 */
  evidence_recipe_ref?: string | null;
  /** ER 从判断单元、状态变量和路径推导而来的稳定血缘。 */
  derivation_refs?: {
    judgment_unit_ref: string | null;
    state_variable_refs: string[];
    path_refs: string[];
  };
  /** task_local 或未绑定状态变量时允许无 Profile，但必须解释。 */
  no_profile_reason?: string | null;
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
  units: Array<{ id: string; title?: string; question?: string; evidence_requirements?: unknown[] }>;
  counter_evidence_directions?: unknown;
}): EvidenceRequirementProjection[] {
  const result: EvidenceRequirementProjection[] = [];
  const seen = new Set<string>();
  const counters = normalizeCounterEvidenceDirections(input.counter_evidence_directions, {
    unitIds: (input.units || []).map((unit) => String(unit.id || "")).filter(Boolean),
  });
  const unitsWithExplicitCounter = new Set(counters.flatMap((counter) => counter.judgment_unit_ids.map(String)));
  for (const unit of input.units || []) {
    const unitId = String(unit.id || "").trim();
    if (!unitId) continue;
    const requirements = Array.isArray(unit.evidence_requirements) ? unit.evidence_requirements : [];
    requirements.forEach((item, index) => {
      const rawRequirement = String(item || "").trim();
      if (!rawRequirement) return;
      const referenceOnly = /^(?:ER|REQ)[-_][A-Z0-9_-]+$/i.test(rawRequirement);
      const referencedRole = /counter|反证|反向/i.test(rawRequirement) ? "counter" as const : "support" as const;
      // Stage02 模型偶尔只输出 ER-xxx-counter 引用；若已有对象化
      // counter_evidence_direction，则跳过占位引用，避免同一反证被投影两次。
      if (referenceOnly && referencedRole === "counter" && unitsWithExplicitCounter.has(unitId)) return;
      const decisionQuestion = String(unit.question || unit.title || unitId).trim();
      const requirement = referenceOnly
        ? referencedRole === "counter"
          ? `取得足以证伪或区分「${decisionQuestion}」的反向数据、替代解释与边界条件`
          : `取得能直接回答「${decisionQuestion}」的价格、库存、供给约束与需求变化时序数据`
        : rawRequirement;
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
        evidence_role: referencedRole,
        minimum_independent_sources: 1,
        judgment_unit_ids: [unitId],
        source: "unit_requirement",
      });
    });
  }
  for (const counter of counters) {
    // Ontology 3.0 要求一条 ER 只服务一个原子 JU。全局反证方向必须在
    // Stage02 拆成逐单元要求，不能让一条宽泛 ER 同时替多个判断单元过门。
    for (const unitId of counter.judgment_unit_ids) {
      let id = `ER-${counter.direction_id}-${unitId}`;
      let n = 1;
      while (seen.has(id)) {
        id = `ER-${counter.direction_id}-${unitId}-${n}`;
        n += 1;
      }
      seen.add(id);
      result.push({
        id,
        requirement: counter.statement,
        evidence_role: "counter",
        minimum_independent_sources: 1,
        judgment_unit_ids: [unitId],
        source: "counter_direction",
        source_ref: counter.direction_id,
      });
    }
  }
  return result;
}

/**
 * Stage02 顶层 EvidenceRequirement 是可执行对象；JudgmentUnit 内只保存引用或兼容旧稿的短句。
 * 只有顶层对象缺失/损坏/指向已删除单元时才允许重新投影，避免 03 把 ER-* 引用当成检索正文。
 */
export function resolveEvidenceRequirementsFromStructure(input: {
  units: Array<{ id: string; title?: string; question?: string; evidence_requirements?: unknown[] }>;
  evidence_requirements?: unknown;
  counter_evidence_directions?: unknown;
}): EvidenceRequirementProjection[] {
  const unitIds = new Set((input.units || []).map((unit) => String(unit.id || "")).filter(Boolean));
  const topLevel = Array.isArray(input.evidence_requirements) ? input.evidence_requirements : [];
  const structurallyValid = topLevel.length > 0 && topLevel.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    const refs = Array.isArray(record.judgment_unit_ids) ? record.judgment_unit_ids.map(String).filter(Boolean) : [];
    return Boolean(String(record.id || "").trim())
      && String(record.requirement || "").trim().length >= 8
      && ["support", "counter", "context", "boundary"].includes(String(record.evidence_role || ""))
      && Number.isFinite(Number(record.minimum_independent_sources))
      && refs.length > 0
      && refs.every((id) => unitIds.has(id));
  });
  if (structurallyValid) {
    const usedIds = new Set<string>();
    return topLevel.flatMap((item: any) => item.judgment_unit_ids.map((unitId: unknown) => {
      const unit = String(unitId);
      const baseId = item.judgment_unit_ids.length === 1
        ? String(item.id)
        : `${String(item.id)}-${unit}`;
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      return {
        id,
        requirement: String(item.requirement),
        evidence_role: item.evidence_role,
        minimum_independent_sources: Math.max(0, Math.floor(Number(item.minimum_independent_sources))),
        judgment_unit_ids: [unit],
        source: item.source === "counter_direction" ? "counter_direction" as const : "unit_requirement" as const,
        ...(item.source_ref ? { source_ref: String(item.source_ref) } : {}),
        evidence_profile_refs: asNonEmptyStrings(item.evidence_profile_refs),
        evidence_recipe_ref: item.evidence_recipe_ref ? String(item.evidence_recipe_ref) : null,
        derivation_refs: item.derivation_refs && typeof item.derivation_refs === "object"
          ? {
            judgment_unit_ref: unit,
            state_variable_refs: asNonEmptyStrings(item.derivation_refs.state_variable_refs),
            path_refs: asNonEmptyStrings(item.derivation_refs.path_refs),
          }
          : undefined,
        no_profile_reason: item.no_profile_reason ? String(item.no_profile_reason) : null,
      };
    }));
  }
  return projectEvidenceRequirementsFromStructure({
    units: input.units,
    counter_evidence_directions: input.counter_evidence_directions,
  });
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
