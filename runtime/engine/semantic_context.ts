import { loadOntologyCatalog, loadSemiconductorBusinessObjectIds } from "./ontology_catalog";
import type { StageKind } from "./types";

export type StageSemanticContext = {
  schema_version: "1.0.0";
  stage: string;
  ontology_versions: string[];
  ontology_fingerprint: string;
  declared_object_ids: string[];
  referenced_semantic_ids: string[];
  resolved_semantic_ids: string[];
  task_local_ids: string[];
  unresolved_semantic_ids: string[];
  reference_coverage: number;
  resolution_status: "complete" | "partial" | "not_applicable";
};

function sortedUniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} 必须为非空字符串组成的列表`);
  }
  const actual = value.map((item) => String(item).trim());
  const expected = [...new Set(actual)].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} 必须去重并按字典序排序`);
  }
  return actual;
}

export function validateStageSemanticContext(
  context: unknown,
  stage: StageKind,
  options: { requireComplete?: boolean; expectedFingerprint?: string } = {},
): StageSemanticContext {
  if (!context || typeof context !== "object") throw new Error(`${stage}.semantic_context 缺失`);
  const value = context as Record<string, unknown>;
  if (value.schema_version !== "1.0.0") throw new Error(`${stage}.semantic_context.schema_version 必须为 1.0.0`);
  if (value.stage !== stage) throw new Error(`${stage}.semantic_context.stage 与阶段不一致`);

  const ontologyVersions = sortedUniqueStrings(value.ontology_versions, `${stage}.ontology_versions`);
  const fingerprint = String(value.ontology_fingerprint || "");
  if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error(`${stage}.ontology_fingerprint 必须为 sha256 指纹`);
  }
  if (options.expectedFingerprint && fingerprint !== options.expectedFingerprint) {
    throw new Error(`${stage}.ontology_fingerprint 与当前正式本体不一致`);
  }

  const declared = sortedUniqueStrings(value.declared_object_ids, `${stage}.declared_object_ids`);
  const referenced = sortedUniqueStrings(value.referenced_semantic_ids, `${stage}.referenced_semantic_ids`);
  const resolved = sortedUniqueStrings(value.resolved_semantic_ids, `${stage}.resolved_semantic_ids`);
  const taskLocal = sortedUniqueStrings(value.task_local_ids, `${stage}.task_local_ids`);
  const unresolved = sortedUniqueStrings(value.unresolved_semantic_ids, `${stage}.unresolved_semantic_ids`);
  const referencedSet = new Set(referenced);
  const resolvedSet = new Set(resolved);
  const unresolvedSet = new Set(unresolved);

  if (resolved.some((id) => !referencedSet.has(id)) || unresolved.some((id) => !referencedSet.has(id))) {
    throw new Error(`${stage}.semantic_context 已解析/未解析集合必须是引用集合的子集`);
  }
  if (resolved.some((id) => unresolvedSet.has(id))) {
    throw new Error(`${stage}.semantic_context 已解析与未解析集合不得相交`);
  }
  if (referenced.some((id) => !resolvedSet.has(id) && !unresolvedSet.has(id))) {
    throw new Error(`${stage}.semantic_context 引用集合必须完整划分为已解析与未解析`);
  }
  if (taskLocal.some((id) => !referencedSet.has(id) || !resolvedSet.has(id) || !id.startsWith("task_local:"))) {
    throw new Error(`${stage}.task_local_ids 必须是已解析引用中的 task_local:*`);
  }

  const expectedCoverage = referenced.length
    ? Number((resolved.length / referenced.length).toFixed(6))
    : 1;
  if (Number(value.reference_coverage) !== expectedCoverage) {
    throw new Error(`${stage}.reference_coverage 与引用解析集合不一致`);
  }
  const expectedStatus = referenced.length === 0
    ? "not_applicable"
    : unresolved.length
      ? "partial"
      : "complete";
  if (value.resolution_status !== expectedStatus) {
    throw new Error(`${stage}.resolution_status 与引用解析结果不一致`);
  }
  if (options.requireComplete && unresolved.length) {
    throw new Error(`${stage} 尚有未解析语义引用: ${unresolved.join(", ")}`);
  }

  return {
    schema_version: "1.0.0",
    stage,
    ontology_versions: ontologyVersions,
    ontology_fingerprint: fingerprint,
    declared_object_ids: declared,
    referenced_semantic_ids: referenced,
    resolved_semantic_ids: resolved,
    task_local_ids: taskLocal,
    unresolved_semantic_ids: unresolved,
    reference_coverage: expectedCoverage,
    resolution_status: expectedStatus,
  };
}

const DECLARATION_KEYS = new Set([
  "id",
  "application_id",
  "question_id",
  "judgment_unit_id",
  "evidence_requirement_id",
  "evidence_id",
  "source_id",
  "source_key",
  "claim_id",
  "expression_id",
  "trace_id",
  "explanation_id",
  "direction_id",
  "gate_id",
]);

const SINGULAR_REFERENCE_KEYS = new Set([
  "scope_ref",
  "judgment_id",
  "judgment_unit_id",
  "rule_ref",
  "source_application_id",
  "parent_scope_ref",
  "source_ref",
  "target_ref",
]);

// Stage01 的 input_resolution.source_refs 是读者可读的输入出处标签，
// 不是 Source 实例或本体语义 ID；不得被宽泛的 *_refs 规则误收。
const NON_SEMANTIC_REFERENCE_LIST_KEYS = new Set(["source_refs"]);

function addString(target: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (normalized) target.add(normalized);
}

function walk(value: unknown, declared: Set<string>, referenced: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, declared, referenced);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // 注入资产证明属于 governance/method/workflow provenance，不是本体对象引用。
    if (key === "semantic_context" || key === "context_injected_assets") continue;
    if (DECLARATION_KEYS.has(key)) addString(declared, item);
    if (SINGULAR_REFERENCE_KEYS.has(key)) addString(referenced, item);
    if (
      !NON_SEMANTIC_REFERENCE_LIST_KEYS.has(key)
      && (key.endsWith("_refs") || key.endsWith("_ids"))
      && Array.isArray(item)
    ) {
      for (const ref of item) addString(referenced, ref);
    }
    walk(item, declared, referenced);
  }
}

/**
 * 为阶段产物建立机器可读的语义封套。
 *
 * 本封套只描述“本次产物围绕哪些语义 ID 组织，以及是否可解析”，不承载
 * 研究方法或推理逻辑。生成和确认阶段用于可观测；生产正式发布时由
 * semantic_baseline 合并校验，未解析引用不得进入可发布包。
 */
export function buildStageSemanticContext(input: {
  stage: string;
  data: unknown;
  upstream?: unknown[];
  additionalResolvedIds?: Iterable<string>;
}): StageSemanticContext {
  const catalog = loadOntologyCatalog();
  const declared = new Set<string>();
  const referenced = new Set<string>();
  walk(input.data, declared, referenced);
  for (const upstream of input.upstream || []) walk(upstream, declared, new Set<string>());

  const formalIds = new Set<string>([
    ...catalog.object_types.keys(),
    ...catalog.relation_types.keys(),
    ...catalog.rules.keys(),
    ...catalog.scenario_types.keys(),
  ]);
  const domainIds = loadSemiconductorBusinessObjectIds();
  const additionalResolvedIds = new Set(
    [...(input.additionalResolvedIds || [])].map(String).filter(Boolean),
  );
  const taskLocal = [...referenced].filter((ref) => ref.startsWith("task_local:")).sort();
  const resolved = [...referenced]
    .filter((ref) =>
      declared.has(ref)
      || formalIds.has(ref)
      || domainIds.has(ref)
      || additionalResolvedIds.has(ref)
      || ref.startsWith("task_local:"))
    .sort();
  const resolvedSet = new Set(resolved);
  const unresolved = [...referenced].filter((ref) => !resolvedSet.has(ref)).sort();
  const coverage = referenced.size ? resolved.length / referenced.size : 1;

  return {
    schema_version: "1.0.0",
    stage: input.stage,
    ontology_versions: [...new Set(Object.values(catalog.model_versions).filter(Boolean))].sort(),
    ontology_fingerprint: catalog.fingerprint,
    declared_object_ids: [...declared].sort(),
    referenced_semantic_ids: [...referenced].sort(),
    resolved_semantic_ids: resolved,
    task_local_ids: taskLocal,
    unresolved_semantic_ids: unresolved,
    reference_coverage: Number(coverage.toFixed(6)),
    resolution_status: referenced.size === 0 ? "not_applicable" : unresolved.length ? "partial" : "complete",
  };
}
