import "server-only";

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { getRun, latestArtifact, listSources, updateRun } from "@/adapters/db";
import { repositoryPath } from "@/adapters/repo-paths";
import { evidenceBoundSources } from "@/engine/evidence_sources";
import { exportFormalPack, type FormalPackExportResult } from "@/engine/formal_pack_export";
import { formalArtifactSha256 } from "@/engine/formal_pack_hash";
import { buildKnowledgePackage } from "@/engine/knowledge_package";
import { collectRunOntologyTouchpoints } from "@/engine/knowledge_browser";
import { loadDataMappingRegistry } from "@/engine/data_mapping_profiles";
import { appendReportClaimSourceIndex, buildReportClaimSourceIndex } from "@/engine/report_source_index";
import { parseManifest } from "@/engine/manifest";
import { parseJson, STAGES, type MethodApplication } from "@/engine/types";

export type ReleaseArtifactResult = {
  package_kind: "formal_delivery_pack" | "research_audit_pack";
  export_dir: string;
  export_rel: string;
  download_url: string;
  fingerprint: string;
  validate_ok: boolean;
  validation: Record<string, unknown>;
};

export type ReleaseSetResult = {
  release_id: string;
  run_id: string;
  published: boolean;
  formal_delivery_pack: ReleaseArtifactResult;
  research_audit_pack: ReleaseArtifactResult;
  validation_summary: Record<string, unknown>;
};

type KnowledgeLock = {
  schema_name: "research_knowledge_lock";
  schema_version: "1.0.0";
  run_id: string;
  release_id: string;
  baseline: { package_id: string; version: string; fingerprint: string };
  task_slice: { package_id: string; version: string; fingerprint: string };
  ontology: { version: string; fingerprint: string; used_semantic_ids: string[] };
  method_versions: Record<string, string>;
  used_methods: Array<{ method_id: string; method_version: string; capability_type: string }>;
  data_mapping_profiles: Array<{ id: string; version: string; connector: string }>;
  connectors: Array<{ id: string; status: "declared_not_runtime_checked" }>;
  injected_knowledge_by_stage: Record<string, string[]>;
  boundary: string;
};

function collectKeyValues(value: unknown, key: string, target: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyValues(item, key, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (nestedKey === key) {
      if (Array.isArray(nestedValue)) {
        for (const item of nestedValue) if (typeof item === "string" && item) target.add(item);
      } else if (typeof nestedValue === "string" && nestedValue) target.add(nestedValue);
    }
    collectKeyValues(nestedValue, key, target);
  }
}

function releaseId(runId: string, reportHash: string, stamp: string): string {
  const digest = createHash("sha256").update(`${runId}:${reportHash}:${stamp}`).digest("hex").slice(0, 12).toUpperCase();
  return `REL-${stamp}-${digest}`;
}

function firstCutoff(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstCutoff(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.cutoff_at === "string" && record.cutoff_at) return record.cutoff_at;
  for (const nested of Object.values(record)) {
    const found = firstCutoff(nested);
    if (found) return found;
  }
  return null;
}

export function buildKnowledgeLock(runId: string, release: string): KnowledgeLock {
  const baseline = buildKnowledgePackage(null);
  const task = buildKnowledgePackage(runId);
  const mapping = loadDataMappingRegistry();
  const applications = new Map<string, { method_id: string; method_version: string; capability_type: string }>();
  const profileIds = new Set<string>();
  const connectorIds = new Set<string>();
  const injected: Record<string, string[]> = {};

  for (const stage of STAGES) {
    const artifact = latestArtifact(runId, stage, ["approved"]);
    if (!artifact) continue;
    const data = parseJson<Record<string, any>>(artifact.json_content, {});
    for (const application of (data.method_applications || []) as MethodApplication[]) {
      if (application.status === "rejected") continue;
      applications.set(application.method_id, {
        method_id: application.method_id,
        method_version: application.method_version,
        capability_type: application.capability_type,
      });
    }
    collectKeyValues(data, "mapping_profile_id", profileIds);
    collectKeyValues(data, "connector", connectorIds);
    const context = parseJson<Record<string, unknown>>(artifact.input_context || "{}", {});
    const files = new Set<string>();
    collectKeyValues(context, "knowledge_files", files);
    injected[stage] = [...files].sort();
  }
  const profiles = mapping.profiles.filter((profile) => profileIds.has(profile.id) || connectorIds.has(profile.connector));
  for (const profile of profiles) connectorIds.add(profile.connector);
  return {
    schema_name: "research_knowledge_lock",
    schema_version: "1.0.0",
    run_id: runId,
    release_id: release,
    baseline: { package_id: baseline.package_id, version: baseline.package_version, fingerprint: baseline.fingerprint },
    task_slice: { package_id: task.package_id, version: task.package_version, fingerprint: task.fingerprint },
    ontology: {
      version: task.manifest.platform_compatibility.ontology,
      fingerprint: task.manifest.ontology_fingerprint,
      used_semantic_ids: collectRunOntologyTouchpoints(runId).sort(),
    },
    method_versions: task.manifest.method_versions,
    used_methods: [...applications.values()].sort((left, right) => left.method_id.localeCompare(right.method_id)),
    data_mapping_profiles: profiles.map((profile) => ({ id: profile.id, version: profile.version, connector: profile.connector })),
    connectors: [...connectorIds].sort().map((id) => ({ id, status: "declared_not_runtime_checked" })),
    injected_knowledge_by_stage: injected,
    boundary: "本锁只记录本次使用的知识身份和版本；知识定义以所引用的知识包为权威，不在研究发布制品中复制。",
  };
}

function copyDeliveryMaterials(
  audit: FormalPackExportResult,
  deliveryDir: string,
  reportData: Record<string, unknown>,
  reportMarkdown: string,
): string[] {
  const sourceDir = path.join(audit.export_dir, audit.names.stage03SnapshotDir, "04_05_materials");
  if (!existsSync(sourceDir)) return [];
  const refs = new Set<string>();
  for (const key of ["figure_id", "figure_ids", "table_id", "table_ids", "material_ref", "material_refs", "display_data_candidate_ids"]) {
    collectKeyValues(reportData, key, refs);
  }
  for (const match of reportMarkdown.matchAll(/\b(?:FIG|TABLE|TBL|CHART|DDC)-[A-Z0-9_-]+\b/gi)) refs.add(match[0]);
  if (!refs.size) return [];
  const materialDir = path.join(deliveryDir, "materials");
  mkdirSync(materialDir, { recursive: true });
  const allowed = new Set(["chart_data_package.csv", "table_material_package.csv", "display_data_candidates.csv"]);
  const copied: string[] = [];
  for (const file of readdirSync(sourceDir)) {
    if (!allowed.has(file)) continue;
    const content = readFileSync(path.join(sourceDir, file), "utf8");
    const [header, ...rows] = content.split(/\r?\n/);
    const selected = rows.filter((row) => [...refs].some((ref) => row.includes(ref)));
    if (!selected.length) continue;
    writeFileSync(path.join(materialDir, file), `${header}\n${selected.join("\n")}\n`, "utf8");
    copied.push(`materials/${file}`);
  }
  return copied.sort();
}

function validateDeliveryPackage(deliveryDir: string, manifest: Record<string, any>) {
  const errors: string[] = [];
  const required = ["README.md", "delivery_manifest.yaml", "package_kind.yaml", String(manifest.report?.artifact || ""), "sources/source-index.json", "knowledge_reference.yaml"];
  for (const file of required) if (!file || !existsSync(path.join(deliveryDir, file))) errors.push(`缺少 ${file || "报告文件"}`);
  const reportPath = path.join(deliveryDir, String(manifest.report?.artifact || ""));
  if (existsSync(reportPath) && formalArtifactSha256(reportPath) !== manifest.report?.hash) errors.push("报告哈希不匹配");
  const forbidden = ["semantic_context.yaml", "business_instance_graph.yaml", "推理审计", "表达审计", "独立语义审查", "数据与证据快照"];
  for (const file of walkRelativeFiles(deliveryDir)) if (forbidden.some((marker) => file.includes(marker))) errors.push(`对外交付包含内部文件 ${file}`);
  return { ok: errors.length === 0, errors };
}

function walkRelativeFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walkRelativeFiles(root, absolute) : [path.relative(root, absolute).split(path.sep).join("/")];
  });
}

function validateAuditPackage(auditDir: string) {
  const validator = repositoryPath("governance", "03_校验", "validate_run.py");
  const result = spawnSync("python3", [validator, auditDir, "--no-write"], {
    cwd: repositoryPath(), encoding: "utf8", env: process.env, timeout: 180_000,
  });
  let parsed: Record<string, any> = {};
  try { parsed = JSON.parse(result.stdout || "{}"); } catch { parsed = { error: (result.stdout || result.stderr || "").slice(0, 3000) }; }
  return {
    ok: result.status === 0 && parsed.ok !== false,
    exit_code: result.status,
    publishable: Boolean(parsed.validation_summary?.publishable || parsed.publishable),
    publish_status: String(parsed.validation_summary?.publish_status || parsed.publish_status || (result.status === 0 ? "PUBLISHABLE" : "RETURN_REQUIRED")),
    errors: parsed.errors || parsed.validation_issues || (parsed.error ? [parsed.error] : []),
  };
}

export function publishReleaseSetAndValidate(runId: string): ReleaseSetResult {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const audit = exportFormalPack(runId, { releaseSet: true, packageKind: "research_audit_pack" });
  const releaseRoot = path.dirname(audit.export_dir);
  const deliveryDir = path.join(releaseRoot, "delivery");
  mkdirSync(deliveryDir, { recursive: true });

  const stage05 = latestArtifact(runId, "stage_05", ["approved"]);
  const stage04 = latestArtifact(runId, "stage_04", ["approved"]);
  if (!stage05 || !stage04) throw new Error("正式发布缺少已确认的 04/05 产物");
  const reportData = parseJson<Record<string, any>>(stage05.json_content, {});
  const judgmentData = parseJson<Record<string, any>>(stage04.json_content, {});
  const sources = evidenceBoundSources(listSources(runId), parseJson(latestArtifact(runId, "stage_03", ["approved"])?.json_content || "{}", {}));
  const reportMarkdown = appendReportClaimSourceIndex(stage05.markdown_content || reportData.document_markdown || "# 研究报告\n", reportData, sources);
  const reportFile = audit.names.stage05ReportMd;
  writeFileSync(path.join(deliveryDir, reportFile), reportMarkdown, "utf8");
  const reportHash = formalArtifactSha256(path.join(deliveryDir, reportFile));
  const release = releaseId(runId, reportHash, audit.names.stamp);
  const knowledgeLock = buildKnowledgeLock(runId, release);
  const cutoff = firstCutoff(judgmentData) || firstCutoff(reportData) || run.updated_at;
  const sourceIndex = buildReportClaimSourceIndex(reportData, sources);
  mkdirSync(path.join(deliveryDir, "sources"), { recursive: true });
  writeFileSync(path.join(deliveryDir, "sources", "source-index.json"), JSON.stringify({
    schema_name: "formal_delivery_source_index", schema_version: "1.0.0", release_id: release, entries: sourceIndex,
  }, null, 2), "utf8");
  const materialFiles = copyDeliveryMaterials(audit, deliveryDir, reportData, reportMarkdown);
  const knowledgeReference = {
    schema_name: "formal_delivery_knowledge_reference",
    schema_version: "1.0.0",
    release_id: release,
    baseline: knowledgeLock.baseline,
    task_slice: knowledgeLock.task_slice,
    ontology: { version: knowledgeLock.ontology.version, fingerprint: knowledgeLock.ontology.fingerprint },
    method_versions: knowledgeLock.method_versions,
  };
  writeFileSync(path.join(deliveryDir, "knowledge_reference.yaml"), YAML.stringify(knowledgeReference), "utf8");
  writeFileSync(path.join(deliveryDir, "package_kind.yaml"), YAML.stringify({
    package_kind: "formal_delivery_pack", layout: "external_delivery", publishable: true,
    note: "只含对外报告、必要材料、来源索引与简化知识溯源；不含内部证据快照和审计链。",
  }), "utf8");
  writeFileSync(path.join(deliveryDir, "README.md"), [
    `# ${audit.names.theme} 对外正式交付包`, "", `release_id: ${release}`, `research_cutoff_at: ${cutoff}`, "",
    `请先阅读 ${reportFile}。完整证据快照和推理审计保存在同 release_id 的内部研究审计包中。`, "",
  ].join("\n"), "utf8");

  const deliveryManifest: Record<string, any> = {
    schema_name: "formal_research_delivery_manifest",
    schema_version: "1.0.0",
    package_kind: "formal_delivery_pack",
    release_id: release,
    run_id: runId,
    generated_at: new Date().toISOString(),
    research_cutoff_at: cutoff,
    report: { artifact: reportFile, hash: reportHash, version: stage05.version },
    sources: { artifact: "sources/source-index.json", entries: sourceIndex.length },
    materials: materialFiles,
    knowledge_reference: "knowledge_reference.yaml",
    publish_status: "PENDING_VALIDATION",
  };
  writeFileSync(path.join(deliveryDir, "delivery_manifest.yaml"), YAML.stringify(deliveryManifest), "utf8");
  const deliveryValidation = validateDeliveryPackage(deliveryDir, deliveryManifest);
  deliveryManifest.publish_status = deliveryValidation.ok ? "PUBLISHABLE" : "RETURN_REQUIRED";
  writeFileSync(path.join(deliveryDir, "delivery_manifest.yaml"), YAML.stringify(deliveryManifest), "utf8");

  writeFileSync(path.join(audit.export_dir, "knowledge_lock.yaml"), YAML.stringify(knowledgeLock), "utf8");
  const embeddedDelivery = path.join(audit.export_dir, "delivery");
  cpSync(deliveryDir, embeddedDelivery, { recursive: true });
  const deliveryFingerprint = formalArtifactSha256(deliveryDir);
  const runManifest = YAML.parse(readFileSync(path.join(audit.export_dir, "run_manifest.yaml"), "utf8")) as Record<string, any>;
  const auditManifest = {
    schema_name: "controlled_research_audit_manifest",
    schema_version: "1.0.0",
    package_kind: "research_audit_pack",
    release_id: release,
    run_id: runId,
    research_cutoff_at: cutoff,
    delivery: { artifact: "delivery", fingerprint: deliveryFingerprint, report_hash: reportHash },
    run_manifest: "run_manifest.yaml",
    knowledge_lock: "knowledge_lock.yaml",
    stage_hashes: Object.fromEntries(Object.entries(runManifest.stages || {}).map(([stage, value]: [string, any]) => [stage, value.hash])),
    validation: { status: "PENDING_VALIDATION" },
  };
  writeFileSync(path.join(audit.export_dir, "audit_manifest.yaml"), YAML.stringify(auditManifest), "utf8");
  const auditValidation = validateAuditPackage(audit.export_dir);
  auditManifest.validation = { status: auditValidation.ok && auditValidation.publishable ? "PUBLISHABLE" : "RETURN_REQUIRED", ...auditValidation };
  writeFileSync(path.join(audit.export_dir, "audit_manifest.yaml"), YAML.stringify(auditManifest), "utf8");

  const knowledgeResolved = buildKnowledgePackage(null).fingerprint === knowledgeLock.baseline.fingerprint
    && buildKnowledgePackage(runId).fingerprint === knowledgeLock.task_slice.fingerprint;
  const paired = YAML.parse(readFileSync(path.join(embeddedDelivery, "delivery_manifest.yaml"), "utf8")).release_id === release
    && YAML.parse(readFileSync(path.join(embeddedDelivery, "delivery_manifest.yaml"), "utf8")).report.hash === reportHash;
  const published = deliveryValidation.ok && auditValidation.ok && auditValidation.publishable && knowledgeResolved && paired;

  const deliveryRel = path.join(path.dirname(audit.export_rel), "delivery");
  const manifest = parseManifest(run.manifest_json, run);
  manifest.validation_summary = { quality_pass: published, publishable: published, publish_status: published ? "PUBLISHABLE" : "RETURN_REQUIRED" };
  (manifest as any).release_set = {
    release_id: release,
    formal_delivery_pack: { export_dir: deliveryDir, export_rel: deliveryRel, fingerprint: deliveryFingerprint },
    research_audit_pack: { export_dir: audit.export_dir, export_rel: audit.export_rel, fingerprint: formalArtifactSha256(audit.export_dir) },
  };
  updateRun(runId, { status: published ? "published" : run.status, manifest_json: JSON.stringify(manifest) });

  const deliveryResult: ReleaseArtifactResult = {
    package_kind: "formal_delivery_pack",
    export_dir: deliveryDir,
    export_rel: deliveryRel,
    download_url: `/api/runs/${runId}/packages/delivery`,
    fingerprint: deliveryFingerprint,
    validate_ok: deliveryValidation.ok,
    validation: deliveryValidation,
  };
  const auditResult: ReleaseArtifactResult = {
    package_kind: "research_audit_pack",
    export_dir: audit.export_dir,
    export_rel: audit.export_rel,
    download_url: process.env.WORKBENCH_ALLOW_AUDIT_DOWNLOAD === "true" ? `/api/runs/${runId}/packages/audit` : "",
    fingerprint: formalArtifactSha256(audit.export_dir),
    validate_ok: auditValidation.ok && auditValidation.publishable,
    validation: auditValidation,
  };
  return {
    release_id: release,
    run_id: runId,
    published,
    formal_delivery_pack: deliveryResult,
    research_audit_pack: auditResult,
    validation_summary: {
      publishable: published,
      publish_status: published ? "PUBLISHABLE" : "RETURN_REQUIRED",
      knowledge_lock_resolved: knowledgeResolved,
      release_pair_consistent: paired,
    },
  };
}

export function releaseDirectoryFingerprint(dir: string): string {
  if (!statSync(dir).isDirectory()) throw new Error("发布制品目录不存在");
  return formalArtifactSha256(dir);
}
