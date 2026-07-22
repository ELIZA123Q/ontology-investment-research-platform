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
  const affected = new Set(changeSet.affected_object_refs);

  for (const [section, ids] of Object.entries(changeSet.removals)) {
    if (!allowed.has(section as never)) throw new Error(`ChangeSet 不允许修改 ${section}`);
    const current = arraySection(next, section);
    const known = new Set(current.map(objectId).filter(Boolean));
    for (const id of ids) {
      if (!affected.has(id)) throw new Error(`删除对象 ${id} 未声明为受影响对象`);
      if (!known.has(id)) throw new Error(`不能删除不存在的对象 ${id}`);
    }
    next[section] = current.filter((item) => !ids.includes(objectId(item)));
  }

  for (const [section, values] of Object.entries(changeSet.upserts)) {
    if (!allowed.has(section as never)) throw new Error(`ChangeSet 不允许修改 ${section}`);
    if (section === "unresolved_gaps") {
      next[section] = [...new Set(values.map(String))];
      continue;
    }
    const current = arraySection(next, section);
    const byId = new Map(current.map((item) => [objectId(item), item]));
    for (const value of values) {
      if (!value || typeof value !== "object") throw new Error(`${section} upsert 必须是对象`);
      const id = objectId(value);
      if (!id) throw new Error(`${section} upsert 缺少稳定 ID`);
      if (!affected.has(id)) throw new Error(`更新对象 ${id} 未声明为受影响对象`);
      byId.set(id, value);
    }
    next[section] = [...byId.values()];
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

const stage03Sections = stageSections.stage_03;

export type Stage03Patch = {
  affected_object_refs: string[];
  upserts: Record<string, unknown[]>;
  removals?: Record<string, string[]>;
};

export function mergeStage03Patch(base: Record<string, unknown>, patch: Stage03Patch) {
  const affected = new Set(patch.affected_object_refs);
  const next = structuredClone(base);

  for (const [section, ids] of Object.entries(patch.removals || {})) {
    if (!stage03Sections.has(section as never)) throw new Error(`Stage03 patch 不允许修改 ${section}`);
    const current = arraySection(next, section);
    const known = new Set(current.map(objectId).filter(Boolean));
    for (const id of ids) {
      if (!affected.has(id)) throw new Error(`删除对象 ${id} 未声明为受影响对象`);
      if (!known.has(id)) throw new Error(`不能删除不存在的对象 ${id}`);
    }
    next[section] = current.filter((item) => !ids.includes(objectId(item)));
  }

  for (const [section, values] of Object.entries(patch.upserts)) {
    if (!stage03Sections.has(section as never)) throw new Error(`Stage03 patch 不允许修改 ${section}`);
    if (section === "unresolved_gaps") {
      next[section] = [...new Set(values.map(String))];
      continue;
    }
    const current = arraySection(next, section);
    const byId = new Map(current.map((item) => [objectId(item), item]));
    for (const value of values) {
      if (!value || typeof value !== "object") throw new Error(`${section} upsert 必须是对象`);
      const id = objectId(value);
      if (!id) throw new Error(`${section} upsert 缺少稳定 ID`);
      if (!affected.has(id)) throw new Error(`更新对象 ${id} 未声明为受影响对象`);
      byId.set(id, value);
    }
    next[section] = [...byId.values()];
  }
  return next;
}
