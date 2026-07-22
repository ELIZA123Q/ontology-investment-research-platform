import { z } from "zod";

const stageSections = {
  stage_03: new Set(["sources", "evidence_drafts", "method_applications", "unresolved_gaps"]),
  stage_04: new Set(["signals", "hypotheses", "competing_explanations", "rule_evaluations", "judgments", "reasoning_traces", "method_applications"]),
} as const;

export const changeSetSchema = z.object({
  target_stage: z.enum(["stage_03", "stage_04"]),
  trigger_event_id: z.string().min(1),
  base_artifact_id: z.string().min(1),
  base_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
  target_attempt: z.number().int().positive(),
  expected_graph_version: z.number().int().nonnegative(),
  affected_stage_refs: z.array(z.enum(["stage_03", "stage_04", "stage_05"])).min(1),
  affected_object_refs: z.array(z.string()).min(1),
  rationale: z.string().min(1),
  upserts: z.record(z.string(), z.array(z.unknown())),
  removals: z.record(z.string(), z.array(z.string())),
});

export type ChangeSet = z.infer<typeof changeSetSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 增量 upsert 语义：字段级合并。
 * - undefined：保留基座
 * - null：不覆盖基座已有非 null 值（模型常把“未改/不确定”写成 null）
 * - 空字符串：不覆盖基座已有非空字符串（模型常把 locator/source_quote 写成 ""）
 * - 纯对象：递归合并
 * - 数组 / 非空标量：以 patch 为准
 */
export function mergeUpsertObject(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (patch === null) {
    return base !== undefined && base !== null ? base : null;
  }
  if (typeof patch === "string" && patch.trim() === "") {
    if (typeof base === "string" && base.trim() !== "") return base;
    return patch;
  }
  if (Array.isArray(patch)) return patch;
  if (isPlainObject(patch)) {
    if (!isPlainObject(base)) {
      const created: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        created[key] = mergeUpsertObject(undefined, value);
      }
      return created;
    }
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = mergeUpsertObject(base[key], value);
    }
    return merged;
  }
  return patch;
}

function applyUpserts(
  next: Record<string, unknown>,
  section: string,
  values: unknown[],
  affected: Set<string>,
) {
  if (section === "unresolved_gaps") {
    next[section] = [...new Set(values.map(String))];
    return;
  }
  const current = arraySection(next, section);
  const byId = new Map(current.map((item) => [objectId(item), item]));
  for (const value of values) {
    if (!value || typeof value !== "object") throw new Error(`${section} upsert 必须是对象`);
    const id = objectId(value);
    if (!id) throw new Error(`${section} upsert 缺少稳定 ID`);
    if (!affected.has(id)) throw new Error(`更新对象 ${id} 未声明为受影响对象`);
    byId.set(id, mergeUpsertObject(byId.get(id), value));
  }
  next[section] = [...byId.values()];
}

/**
 * 模型补证常见两类假失败：
 * 1) 多轮自动补证重复删除同一 ID
 * 2) removals 写错 section（把 EV-* 写进 sources）
 * 删除改为幂等：按稳定 ID 在允许 section 内查找并移除；找不到则忽略。
 */
export function applyIdempotentRemovals(
  next: Record<string, unknown>,
  removals: Record<string, string[]>,
  allowedSections: Set<string>,
) {
  const requestedIds = new Set<string>();
  for (const [section, ids] of Object.entries(removals || {})) {
    if (!allowedSections.has(section)) throw new Error(`不允许修改 ${section}`);
    for (const id of ids || []) {
      if (id) requestedIds.add(String(id));
    }
  }
  if (!requestedIds.size) return;

  for (const section of allowedSections) {
    if (section === "unresolved_gaps") {
      const current = arraySection(next, section).map(String);
      next[section] = current.filter((item) => {
        for (const id of requestedIds) {
          if (item === id || item.startsWith(`${id}:`) || item.startsWith(`${id} `)) return false;
        }
        return true;
      });
      continue;
    }
    const current = arraySection(next, section);
    next[section] = current.filter((item) => !requestedIds.has(objectId(item)));
  }
}

export function mergeChangeSet(base: Record<string, unknown>, raw: ChangeSet) {
  const changeSet = changeSetSchema.parse(raw);
  const allowed = stageSections[changeSet.target_stage];
  const targetIndex = Number(changeSet.target_stage.slice(-2));
  if (!changeSet.affected_stage_refs.includes(changeSet.target_stage)) {
    throw new Error("affected_stage_refs 必须包含目标阶段");
  }
  for (const stage of changeSet.affected_stage_refs) {
    if (Number(stage.slice(-2)) < targetIndex) throw new Error(`ChangeSet 不允许把上游 ${stage} 标记为受影响`);
  }
  const next = structuredClone(base);
  const affected = new Set(expandAffectedObjectRefs(changeSet));
  // 先并入 removal 声明，再幂等删除（不因“对象已不存在/写错 section”失败）
  for (const id of expandAffectedObjectRefs({ removals: changeSet.removals })) {
    affected.add(id);
  }
  applyIdempotentRemovals(next, changeSet.removals, allowed as Set<string>);

  for (const [section, values] of Object.entries(changeSet.upserts)) {
    if (!allowed.has(section as never)) throw new Error(`ChangeSet 不允许修改 ${section}`);
    applyUpserts(next, section, values, affected);
  }
  return next;
}

function arraySection(base: Record<string, unknown>, section: string): unknown[] {
  const value = base[section];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${section} 不是数组，不能应用 ChangeSet`);
  return value;
}

export function objectId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  for (const key of ["id", "application_id", "source_key", "signal_id", "hypothesis_id", "explanation_id", "judgment_id"]) {
    if (object[key]) return String(object[key]);
  }
  return "";
}

/**
 * 模型常漏写 affected_object_refs。upsert/removal 本身已是修改声明，
 * 合并前把其中稳定 ID 并入受影响集合，避免“更新了却未声明”假失败。
 */
export function expandAffectedObjectRefs(input: {
  affected_object_refs?: string[] | null;
  upserts?: Record<string, unknown[]> | null;
  removals?: Record<string, string[]> | null;
}): string[] {
  const refs = new Set((input.affected_object_refs || []).map(String).filter(Boolean));
  for (const values of Object.values(input.upserts || {})) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === "string") {
        if (value) refs.add(value);
        continue;
      }
      const id = objectId(value);
      if (id) refs.add(id);
    }
  }
  for (const ids of Object.values(input.removals || {})) {
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (id) refs.add(String(id));
    }
  }
  return [...refs];
}

const stage03Sections = stageSections.stage_03;

export type Stage03Patch = {
  affected_object_refs: string[];
  upserts: Record<string, unknown[]>;
  removals?: Record<string, string[]>;
};

export function normalizeStage03Patch(patch: Stage03Patch): Stage03Patch {
  return {
    ...patch,
    affected_object_refs: expandAffectedObjectRefs(patch),
    upserts: patch.upserts || {},
    removals: patch.removals || {},
  };
}

export function mergeStage03Patch(base: Record<string, unknown>, patch: Stage03Patch) {
  const normalized = normalizeStage03Patch(patch);
  const affected = new Set(normalized.affected_object_refs);
  const next = structuredClone(base);

  applyIdempotentRemovals(next, normalized.removals || {}, stage03Sections as Set<string>);

  for (const [section, values] of Object.entries(normalized.upserts)) {
    if (!stage03Sections.has(section as never)) throw new Error(`Stage03 patch 不允许修改 ${section}`);
    applyUpserts(next, section, values, affected);
  }
  return next;
}
