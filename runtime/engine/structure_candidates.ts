/** Stage02 竞争解释 / 反向证据：与本体 CompetingExplanation→JudgmentUnit 对齐的候选对象。 */

export type StructureCandidate = {
  explanation_id?: string;
  direction_id?: string;
  statement: string;
  judgment_unit_ids: string[];
};

export type CompetingExplanationCandidate = {
  explanation_id: string;
  statement: string;
  judgment_unit_ids: string[];
};

export type CounterEvidenceDirectionCandidate = {
  direction_id: string;
  statement: string;
  judgment_unit_ids: string[];
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

export function normalizeCompetingExplanations(
  raw: unknown,
  options: { unitIds?: Iterable<string>; prefix?: string } = {},
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
    result.push({
      explanation_id: id,
      statement,
      judgment_unit_ids: asUnitIds(record?.judgment_unit_ids, allowed),
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

/** Stage02 CE 中绑定到指定 JU 的候选；未绑定（待归属）不自动进入任何 JU。 */
export function competingExplanationsForUnit(
  candidates: CompetingExplanationCandidate[],
  unitId: string,
): CompetingExplanationCandidate[] {
  return candidates.filter((item) => item.judgment_unit_ids.includes(unitId));
}

export function formatCandidateBullet(item: { statement: string; judgment_unit_ids?: string[] }): string {
  const units = item.judgment_unit_ids || [];
  const suffix = units.length ? `（挂接 ${units.join("、")}）` : "（待归属）";
  return `${item.statement}${suffix}`;
}
