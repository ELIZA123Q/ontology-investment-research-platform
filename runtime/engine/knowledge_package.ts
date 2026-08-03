import "server-only";

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getRun, latestArtifact } from "@/adapters/db";
import { repositoryPath } from "@/adapters/repo-paths";
import { collectRunOntologyTouchpoints, getRunOntologyResearchValue } from "@/engine/knowledge_browser";
import { loadDataMappingRegistry } from "@/engine/data_mapping_profiles";
import { loadMethodRegistry, inferJudgmentTypesFromTask, recallRegisteredMethodCandidates, type RegisteredMethod } from "@/engine/method_registry";
import { loadOntologyCatalog, ONTOLOGY_MODEL_FILES, ONTOLOGY_MODEL_REGISTRY_FILE, type OntologyElementDefinition } from "@/engine/ontology_catalog";
import { parseJson, STAGES, type MethodApplication } from "@/engine/types";

export type KnowledgePackageKind = "knowledge_baseline" | "knowledge_task_slice";
export type KnowledgePackageFile = { file_name: string; content: string };
export type KnowledgePackageManifest = {
  schema_name: "portable_research_knowledge_manifest";
  schema_version: "1.0.0" | "1.1.0";
  package_id: string;
  package_kind: KnowledgePackageKind;
  package_version: string;
  generated_at: string;
  supported_domains: string[];
  platform_compatibility: { public_contract: string; ontology: string };
  baseline_ref: { package_id: string; fingerprint: string } | null;
  run_context: { run_id: string; task_id: string; question: string; domain: string; judgment_types: string[] } | null;
  ontology_fingerprint: string;
  method_versions: Record<string, string>;
  required_connectors: string[];
  contents: Record<string, unknown>;
  excludes: string[];
  checksums: Record<string, string>;
  content_fingerprint: string;
};

export type KnowledgePackage = {
  package_id: string;
  package_kind: KnowledgePackageKind;
  package_version: string;
  fingerprint: string;
  generated_at: string;
  scope: "formal_baseline" | "run_context";
  run_id: string | null;
  manifest: KnowledgePackageManifest;
  files: KnowledgePackageFile[];
};

const KNOWLEDGE_VERSION = "1.0.0";
const METHOD_ASSET_ROOTS = ["methods/02_判断结构", "methods/03_取证", "methods/04_裁决"];
const ALWAYS_INCLUDED_METHOD_FILES = [
  "methods/README.md",
  "methods/00_登记/method_assets.yaml",
  "methods/02_判断结构/README.md",
  "methods/02_判断结构/00_framework_dependency_registry.yaml",
  "methods/03_取证/README.md",
  "methods/03_取证/03_registry.yaml",
  "methods/03_取证/source_routes.yaml",
  "methods/04_裁决/README.md",
  "governance/02_合同/judgment_method_routes.yaml",
];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function stableFilesFingerprint(files: KnowledgePackageFile[]): string {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.file_name.localeCompare(right.file_name))) {
    digest.update(file.file_name);
    digest.update("\0");
    digest.update(sha256(file.content));
    digest.update("\n");
  }
  return `sha256:${digest.digest("hex")}`;
}

function readRepoFile(file: string): KnowledgePackageFile {
  return { file_name: file, content: readFileSync(repositoryPath(file), "utf8") };
}

function collectFiles(relativeRoot: string): string[] {
  const absoluteRoot = repositoryPath(relativeRoot);
  const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return visit(absolute);
    const relative = path.relative(repositoryPath(), absolute).split(path.sep).join("/");
    return /\.(?:md|ya?ml|json|csv)$/.test(entry.name) ? [relative] : [];
  });
  return visit(absoluteRoot).sort();
}

function catalogDocument(definitions?: OntologyElementDefinition[]) {
  const catalog = loadOntologyCatalog();
  if (definitions) {
    return {
      schema_name: "ontology_catalog_subset_export",
      schema_version: catalog.schema_version,
      fingerprint: catalog.fingerprint,
      definitions,
    };
  }
  return {
    schema_name: "ontology_catalog_export",
    schema_version: catalog.schema_version,
    fingerprint: catalog.fingerprint,
    model_versions: catalog.model_versions,
    object_types: Object.fromEntries(catalog.object_types),
    relation_types: Object.fromEntries(catalog.relation_types),
    rules: Object.fromEntries(catalog.rules),
    scenario_types: Object.fromEntries(catalog.scenario_types),
  };
}

function methodVersions(methods: RegisteredMethod[]): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const method of methods) versions[method.capability_type] = method.method_version;
  return versions;
}

function methodCatalog(methods: RegisteredMethod[]) {
  return {
    schema_name: "research_method_catalog_export",
    schema_version: "1.0.0",
    methods,
  };
}

function selectedRunKnowledge(runId: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在，不能导出任务知识切片包");
  const stageData = STAGES.map((stage) => {
    const artifact = latestArtifact(runId, stage, ["approved"]);
    return artifact ? { stage, artifact, data: parseJson<Record<string, any>>(artifact.json_content, {}) } : null;
  }).filter(Boolean) as Array<{ stage: string; artifact: NonNullable<ReturnType<typeof latestArtifact>>; data: Record<string, any> }>;

  const registered = loadMethodRegistry();
  const selectedIds = new Set<string>();
  for (const { data } of stageData) {
    for (const application of (data.method_applications || []) as MethodApplication[]) {
      if (application.status !== "rejected" && registered.has(application.method_id)) selectedIds.add(application.method_id);
    }
  }
  if (!selectedIds.size) {
    for (const method of recallRegisteredMethodCandidates(run.question)) selectedIds.add(method.method_id);
  }
  if ([...selectedIds].some((id) => id.startsWith("kb04:"))) selectedIds.add("kb04:A00");

  // 替代方法属于合同的一部分；携带其定义可保证切片离线解释完整，但不等于本次执行过。
  const queue = [...selectedIds];
  while (queue.length) {
    const current = registered.get(queue.shift()!);
    for (const alternative of current?.alternatives || []) {
      if (!registered.has(alternative) || selectedIds.has(alternative)) continue;
      selectedIds.add(alternative);
      queue.push(alternative);
    }
  }
  const methods = [...selectedIds].map((id) => registered.get(id)).filter(Boolean) as RegisteredMethod[];

  const ontologyIds = new Set<string>(collectRunOntologyTouchpoints(runId));
  const value = getRunOntologyResearchValue(runId);
  for (const id of value?.relevant_node_ids || []) ontologyIds.add(id);
  for (const { data } of stageData) {
    for (const application of (data.method_applications || []) as MethodApplication[]) {
      for (const id of application.target_ontology_object_refs || []) ontologyIds.add(id);
    }
  }
  const definitions = ontologyDependencyClosure(ontologyIds);

  const profileIds = new Set<string>();
  const connectors = new Set<string>();
  const knowledgeFiles = new Set<string>();
  for (const { artifact, data } of stageData) {
    collectKeyValues(data, "mapping_profile_id", profileIds);
    collectKeyValues(data, "connector", connectors);
    const context = parseJson<Record<string, any>>(artifact.input_context || "{}", {});
    collectKeyValues(context, "knowledge_files", knowledgeFiles);
  }
  const mapping = loadDataMappingRegistry();
  const profiles = mapping.profiles.filter((profile) => profileIds.has(profile.id) || connectors.has(profile.connector));
  for (const profile of profiles) connectors.add(profile.connector);

  const stage01 = stageData.find((item) => item.stage === "stage_01")?.data || {};
  const currentStructureArtifact = latestArtifact(runId, "stage_02", ["needs_review"])
    || latestArtifact(runId, "stage_02", ["approved"]);
  const currentStructure = currentStructureArtifact
    ? parseJson<Record<string, any>>(currentStructureArtifact.json_content, {})
    : {};
  const taskLocalOntology = (Array.isArray(currentStructure.variables) ? currentStructure.variables : [])
    .filter((variable: any) => String(variable?.ontology_node_id || "").startsWith("task_local:"))
    .map((variable: any) => ({
      authority: "task_local" as const,
      ontology_node_id: String(variable.ontology_node_id),
      variable_id: String(variable.id || ""),
      name: String(variable.name || variable.id || "未命名候选"),
      category: String(variable.category || "unknown"),
      variable_kind: String(variable.variable_kind || "unknown"),
      definition: String(variable.definition || ""),
      anchors: Array.isArray(variable.anchors) ? variable.anchors.map(String) : [],
      source_artifact_id: currentStructureArtifact?.id || "",
      source_artifact_version: currentStructureArtifact?.version || 0,
      source_artifact_status: currentStructureArtifact?.status || "unknown",
      used_at: ["stage_02"],
    }));
  return {
    run,
    methods: methods.sort((left, right) => left.method_id.localeCompare(right.method_id)),
    definitions,
    ontologyIds: [...new Set(definitions.map((definition) => definition.id))].sort(),
    profiles,
    connectors: [...connectors].sort(),
    knowledgeFiles: [...knowledgeFiles].sort(),
    taskId: String(stage01.task_id || `JTASK-${run.id}`),
    judgmentTypes: inferJudgmentTypesFromTask(run.question).sort(),
    taskLocalOntology,
  };
}

function collectKeyValues(value: unknown, key: string, target: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyValues(item, key, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (nestedKey === key) {
      if (Array.isArray(nestedValue)) for (const item of nestedValue) if (typeof item === "string" && item) target.add(item);
      else if (typeof nestedValue === "string" && nestedValue) target.add(nestedValue);
    }
    collectKeyValues(nestedValue, key, target);
  }
}

function ontologyDependencyClosure(initialIds: Set<string>): OntologyElementDefinition[] {
  const catalog = loadOntologyCatalog();
  const all = [
    ...catalog.object_types.values(),
    ...catalog.relation_types.values(),
    ...catalog.rules.values(),
    ...catalog.scenario_types.values(),
  ];
  const byId = new Map(all.map((definition) => [definition.id, definition]));
  const included = new Set([...initialIds].filter((id) => byId.has(id)));
  const queue = [...included];
  while (queue.length) {
    const definition = byId.get(queue.shift()!);
    if (!definition) continue;
    const refs = [definition.extends, definition.projects_to, ...(definition.source_types || []), ...(definition.target_types || [])];
    const serialized = JSON.stringify(definition);
    for (const candidate of all) if (serialized.includes(`"${candidate.id}"`)) refs.push(candidate.id);
    for (const ref of refs) {
      if (!ref || included.has(ref) || !byId.has(ref)) continue;
      included.add(ref);
      queue.push(ref);
    }
  }
  return [...included].map((id) => byId.get(id)!).sort((left, right) => left.id.localeCompare(right.id));
}

function selectedMethodFiles(methods: RegisteredMethod[]): string[] {
  const ids = new Set(methods.map((method) => method.method_id));
  const files = new Set(ALWAYS_INCLUDED_METHOD_FILES);
  for (const method of methods) if (method.file) files.add(method.file);
  for (const root of METHOD_ASSET_ROOTS) {
    for (const file of collectFiles(root)) {
      if (!file.endsWith(".md")) continue;
      const content = readFileSync(repositoryPath(file), "utf8");
      if ([...ids].some((id) => content.includes(id.replace(/^kb0[34]:/, "")) || content.includes(id))) files.add(file);
    }
  }
  return [...files].sort();
}

function baselineFiles(): KnowledgePackageFile[] {
  const mapping = loadDataMappingRegistry();
  const methods = [...loadMethodRegistry().values()].sort((left, right) => left.method_id.localeCompare(right.method_id));
  const files: KnowledgePackageFile[] = [
    { file_name: "catalog/formal-ontology-catalog.json", content: json(catalogDocument()) },
    { file_name: "catalog/research-method-catalog.json", content: json(methodCatalog(methods)) },
    { file_name: "catalog/data-mapping-registry.json", content: json({ ...mapping, profile_by_connector: undefined }) },
    { file_name: "ontology/model_registry.yaml", content: readFileSync(repositoryPath(ONTOLOGY_MODEL_REGISTRY_FILE), "utf8") },
    ...ONTOLOGY_MODEL_FILES.map((file) => ({
      file_name: `ontology/models/${file}`,
      content: readFileSync(repositoryPath("ontology", "01_通用", "models", file), "utf8"),
    })),
  ];
  const assets = new Set<string>([
    ...ALWAYS_INCLUDED_METHOD_FILES,
    ...METHOD_ASSET_ROOTS.flatMap(collectFiles),
    ...collectFiles("ontology/02_领域/semiconductor"),
    "governance/02_合同/ontology_data_mapping_profiles.yaml",
  ]);
  for (const file of [...assets].sort()) files.push(readRepoFile(file));
  return files;
}

function taskSliceFiles(runId: string): { files: KnowledgePackageFile[]; context: ReturnType<typeof selectedRunKnowledge> } {
  const context = selectedRunKnowledge(runId);
  const mapping = loadDataMappingRegistry();
  const routeRegistry = YAML.parse(readFileSync(repositoryPath("governance/02_合同/judgment_method_routes.yaml"), "utf8")) as Record<string, any>;
  const routes = Object.fromEntries(context.judgmentTypes.flatMap((type) => routeRegistry.routes?.[type] ? [[type, routeRegistry.routes[type]]] : []));
  const files: KnowledgePackageFile[] = [
    { file_name: "catalog/ontology-subset.json", content: json(catalogDocument(context.definitions)) },
    { file_name: "catalog/research-method-subset.json", content: json(methodCatalog(context.methods)) },
    { file_name: "catalog/data-mapping-subset.json", content: json({
      schema_name: mapping.schema_name,
      schema_version: mapping.schema_version,
      formal_ontology_version: mapping.formal_ontology_version,
      required_provenance_fields: mapping.required_provenance_fields,
      required_connectors: context.connectors,
      profiles: context.profiles,
    }) },
    { file_name: "routing/judgment-method-routes.json", content: json({
      schema_name: "judgment_method_route_subset",
      schema_version: routeRegistry.schema_version,
      knowledge_versions: routeRegistry.knowledge_versions,
      global_optional_reasoning_methods: routeRegistry.global_optional_reasoning_methods,
      routes,
    }) },
    { file_name: "context/selection-profile.json", content: json({
      schema_name: "research_knowledge_selection_profile",
      schema_version: "1.0.0",
      run_id: context.run.id,
      task_id: context.taskId,
      question: context.run.question,
      domain: context.run.domain,
      judgment_types: context.judgmentTypes,
      selected_method_ids: context.methods.map((method) => method.method_id),
      relevant_ontology_ids: context.ontologyIds,
      mapping_profile_ids: context.profiles.map((profile) => profile.id),
      injected_knowledge_files: context.knowledgeFiles,
      boundary: "本文件只记录知识选择，不包含证据、事实、判断或报告。",
    }) },
    { file_name: "context/task-local-ontology.json", content: json({
      schema_name: "task_local_ontology_context",
      schema_version: "1.0.0",
      run_id: context.run.id,
      authority: "task_local",
      boundary: "这些概念只在本研究中生效，不属于正式知识基线；治理确认前不得用于跨任务推理。",
      candidates: context.taskLocalOntology,
    }) },
  ];
  for (const file of selectedMethodFiles(context.methods)) files.push(readRepoFile(file));
  return { files, context };
}

export function buildKnowledgePackage(runId?: string | null, now = new Date()): KnowledgePackage {
  const catalog = loadOntologyCatalog();
  const mapping = loadDataMappingRegistry();
  const packageKind: KnowledgePackageKind = runId ? "knowledge_task_slice" : "knowledge_baseline";
  const task = runId ? taskSliceFiles(runId) : null;
  const payloadFiles = task?.files || baselineFiles();
  const contentFingerprint = stableFilesFingerprint(payloadFiles);
  const packageId = `KB-${packageKind === "knowledge_baseline" ? "BASE" : "TASK"}-${contentFingerprint.slice(7, 19).toUpperCase()}`;
  const baselineFingerprint = runId ? stableFilesFingerprint(baselineFiles()) : contentFingerprint;
  const baselinePackageId = `KB-BASE-${baselineFingerprint.slice(7, 19).toUpperCase()}`;
  const methods = task?.context.methods || [...loadMethodRegistry().values()];
  const generatedAt = now.toISOString();
  const readme = {
    file_name: "README.md",
    content: [
      `# ${packageKind === "knowledge_baseline" ? "正式知识基线包" : "任务知识切片包"}`,
      "",
      "本包保存可复用的本体、研究方法、方法路由与数据映射，不保存任何一次研究的事实或结论。",
      packageKind === "knowledge_task_slice" ? `本切片绑定研究 ${runId}，只携带该任务所需的知识及依赖闭包。` : "本基线包含当前 core 与 semiconductor 的完整正式知识。",
      "",
      "## 与正式研究发布制品的边界",
      "",
      "正式研究发布制品保存本次证据、判断和报告，并通过 knowledge_lock.yaml 引用本包；研究发布制品不能直接导回知识库。",
      "",
    ].join("\n"),
  };
  const checksumFiles = [readme, ...payloadFiles];
  const checksums = Object.fromEntries(checksumFiles.map((file) => [file.file_name, sha256(file.content)]));
  const manifest: KnowledgePackageManifest = {
    schema_name: "portable_research_knowledge_manifest",
    schema_version: "1.1.0",
    package_id: packageId,
    package_kind: packageKind,
    package_version: KNOWLEDGE_VERSION,
    generated_at: generatedAt,
    supported_domains: packageKind === "knowledge_baseline" ? ["core", "semiconductor"] : [task!.context.run.domain],
    platform_compatibility: { public_contract: "1.3.0", ontology: mapping.formal_ontology_version },
    baseline_ref: packageKind === "knowledge_task_slice" ? { package_id: baselinePackageId, fingerprint: baselineFingerprint } : null,
    run_context: packageKind === "knowledge_task_slice" ? {
      run_id: task!.context.run.id,
      task_id: task!.context.taskId,
      question: task!.context.run.question,
      domain: task!.context.run.domain,
      judgment_types: task!.context.judgmentTypes,
    } : null,
    ontology_fingerprint: catalog.fingerprint,
    method_versions: methodVersions(methods),
    required_connectors: packageKind === "knowledge_baseline" ? mapping.required_connectors : task!.context.connectors,
    contents: {
      ontology_definitions: packageKind === "knowledge_baseline"
        ? catalog.object_types.size + catalog.relation_types.size + catalog.rules.size + catalog.scenario_types.size
        : task!.context.definitions.length,
      methods: methods.length,
      mapping_profiles: packageKind === "knowledge_baseline" ? mapping.profiles.length : task!.context.profiles.length,
      task_scoped: packageKind === "knowledge_task_slice",
      task_local_ontology: packageKind === "knowledge_task_slice" ? task!.context.taskLocalOntology.length : 0,
    },
    excludes: ["research_facts", "evidence_snapshots", "judgments", "research_report", "model_raw_output", "credentials"],
    checksums,
    content_fingerprint: contentFingerprint,
  };
  const files = [readme, { file_name: "manifest.json", content: json(manifest) }, ...payloadFiles];
  return {
    package_id: packageId,
    package_kind: packageKind,
    package_version: KNOWLEDGE_VERSION,
    fingerprint: contentFingerprint,
    generated_at: generatedAt,
    scope: packageKind === "knowledge_baseline" ? "formal_baseline" : "run_context",
    run_id: runId || null,
    manifest,
    files,
  };
}

export function validateKnowledgePackageFiles(files: Map<string, string>) {
  const rawManifest = files.get("manifest.json");
  if (!rawManifest) throw new Error("知识包缺少 manifest.json");
  const manifest = parseJson<KnowledgePackageManifest | null>(rawManifest, null);
  if (!manifest || manifest.schema_name !== "portable_research_knowledge_manifest" || !["1.0.0", "1.1.0"].includes(manifest.schema_version)) {
    throw new Error("知识包 manifest schema 非法");
  }
  if (!["knowledge_baseline", "knowledge_task_slice"].includes(manifest.package_kind)) throw new Error("不允许通过知识接口导入研究发布制品");
  const errors: string[] = [];
  for (const [file, expected] of Object.entries(manifest.checksums || {})) {
    const content = files.get(file);
    if (content === undefined) errors.push(`缺少文件 ${file}`);
    else if (sha256(content) !== expected) errors.push(`校验和不匹配 ${file}`);
  }
  const payload = [...files.entries()]
    .filter(([file]) => !["manifest.json", "README.md"].includes(file))
    .map(([file_name, content]) => ({ file_name, content }));
  if (stableFilesFingerprint(payload) !== manifest.content_fingerprint) errors.push("内容指纹不匹配");
  return { ok: errors.length === 0, errors, manifest };
}

export function knowledgePackageDigest(value: Pick<KnowledgePackage, "fingerprint" | "run_id">): string {
  return createHash("sha256").update(`${value.fingerprint}:${value.run_id || "formal"}`).digest("hex").slice(0, 12);
}
