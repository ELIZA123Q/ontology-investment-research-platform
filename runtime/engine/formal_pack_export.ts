/**
 * 工作台一键导出 formal_pack（中文命名，对齐 7:13 布局）。
 */

import "server-only";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getRun, latestArtifact, listSources, listWorkItems, updateRun } from "../adapters/db";
import { repositoryPath } from "../adapters/repo-paths";
import { evidenceBoundSources } from "./evidence_sources";
import { parseManifest } from "./manifest";
import { parseJson } from "./types";
import { buildFormalPackNames, formalDateStamp, formalThemeSlug } from "./formal_pack_naming";
import { projectFormalSnapshot } from "./formal_snapshot_project";
import { mapIndependentReviewToSemanticYaml } from "./formal_semantic_review";

export type FormalPackExportResult = {
  export_dir: string;
  export_rel: string;
  names: ReturnType<typeof buildFormalPackNames>;
  files: string[];
};

export { mapIndependentReviewToSemanticYaml } from "./formal_semantic_review";

function sha256Text(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function nextSeqForTheme(formalRoot: string, theme: string, date: string): number {
  if (!existsSync(formalRoot)) return 1;
  const prefix = `${theme}-${date}-`;
  let max = 0;
  for (const entry of readdirSync(formalRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const seq = Number(entry.name.slice(prefix.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max + 1;
}

function rewriteSnapshotRefs(markdown: string, snapshotDirName: string): string {
  if (!markdown) return markdown;
  return markdown
    .replace(/snapshot_ref:\s*["']?[^"'\n]+["']?/g, `snapshot_ref: "${snapshotDirName}/manifest.csv"`)
    .replace(/03-[^\s/]*数据与证据快照-[^\s/]+/g, snapshotDirName);
}

export function exportFormalPack(runId: string): FormalPackExportResult {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");

  const s01 = latestArtifact(runId, "stage_01", ["approved"]);
  const s02 = latestArtifact(runId, "stage_02", ["approved"]);
  const s03 = latestArtifact(runId, "stage_03", ["approved"]);
  const s04 = latestArtifact(runId, "stage_04", ["approved"]);
  const s05 = latestArtifact(runId, "stage_05", ["approved"]);
  if (!s01 || !s02 || !s03 || !s04 || !s05) {
    throw new Error("导出正式包要求 01—05 全部已确认");
  }

  const blockers = listWorkItems(runId).filter((item) => item.status === "pending" || item.status === "rework");
  if (blockers.length) throw new Error(`仍有 ${blockers.length} 个待办未完成，不能导出正式包`);

  const d01: any = parseJson(s01.json_content, {});
  const d02: any = parseJson(s02.json_content, {});
  const d03: any = parseJson(s03.json_content, {});
  const d04: any = parseJson(s04.json_content, {});
  const d05: any = parseJson(s05.json_content, {});

  for (const [label, data] of [
    ["01", d01], ["02", d02], ["03", d03], ["04", d04], ["05", d05],
  ] as const) {
    if (String(data.quality_status || "") !== "high_quality_pass") {
      throw new Error(`阶段 ${label} 尚未达到可交接密度，不能导出正式包`);
    }
  }

  const theme = formalThemeSlug({
    core_object: d01.core_object || d01.main_judgment_axis?.object,
    normalized_question: d01.normalized_question,
    question: run.question,
  });
  const date = formalDateStamp();
  const configuredRoot = process.env.WORKBENCH_FORMAL_ROOT?.trim()
    || process.env.WORKBENCH_EXPORT_ROOT?.trim();
  const formalRelBase = configuredRoot
    ? path.join(path.resolve(configuredRoot), "formal")
    : path.join("instances", "00_本机运行", "formal");
  const formalRoot = configuredRoot
    ? formalRelBase
    : repositoryPath(formalRelBase);
  mkdirSync(formalRoot, { recursive: true });
  const seq = nextSeqForTheme(formalRoot, theme, date);
  const names = buildFormalPackNames({
    theme,
    date,
    seq,
    deliveryPrimary: d01.delivery_archetype?.primary || d05.delivery_archetype?.primary,
  });

  const exportDir = path.join(formalRoot, names.dirName);
  mkdirSync(exportDir, { recursive: true });

  const sources = evidenceBoundSources(listSources(runId), d03);
  const snapshotAbs = path.join(exportDir, names.stage03SnapshotDir);
  projectFormalSnapshot({
    snapshotDir: snapshotAbs,
    names,
    runId,
    taskId: String(d01.task_id || `JTASK-${runId}`),
    structure: d02,
    evidence: d03,
    sources,
  });

  const stage01Md = rewriteSnapshotRefs(
    s01.markdown_content || d01.document_markdown || "# 投研需求说明\n",
    names.stage03SnapshotDir,
  );
  const stage02Logic = s02.markdown_content || d02.research_logic_markdown || d02.document_markdown || "# 研究逻辑\n";
  const stage02View = String(d02.ontology_view_yaml || "document_type: task_ontology_view\nnote: missing\n");
  const stage03Prep = rewriteSnapshotRefs(
    s03.markdown_content || d03.preparation_markdown || d03.document_markdown || "# 数据与证据准备\n",
    names.stage03SnapshotDir,
  );
  const stage03Manifest = String(d03.instance_manifest_yaml || "document_type: cross_domain_runtime_instance_manifest\nnote: missing\n");
  const stage04Brief = rewriteSnapshotRefs(
    s04.markdown_content || d04.judgment_brief_markdown || d04.document_markdown || "# 判断简报\n",
    names.stage03SnapshotDir,
  );
  const stage04Audit = rewriteSnapshotRefs(
    String(d04.reasoning_audit_yaml || "document_type: reasoning_audit\nnote: missing\n"),
    names.stage03SnapshotDir,
  );
  const stage05Report = s05.markdown_content || d05.document_markdown || "# 研究报告\n";
  const stage05Audit = String(d05.expression_audit_yaml || "document_type: expression_audit\nnote: missing\n");

  writeFileSync(path.join(exportDir, names.stage01Md), stage01Md, "utf8");
  writeFileSync(path.join(exportDir, names.stage02LogicMd), stage02Logic, "utf8");
  writeFileSync(path.join(exportDir, names.stage02ViewYaml), stage02View, "utf8");
  writeFileSync(path.join(exportDir, names.stage03PrepMd), stage03Prep, "utf8");
  writeFileSync(path.join(exportDir, names.stage03ManifestYaml), stage03Manifest, "utf8");
  writeFileSync(path.join(exportDir, names.stage04BriefMd), stage04Brief, "utf8");
  writeFileSync(path.join(exportDir, names.stage04AuditYaml), stage04Audit, "utf8");
  writeFileSync(path.join(exportDir, names.stage05ReportMd), stage05Report, "utf8");
  writeFileSync(path.join(exportDir, names.stage05AuditYaml), stage05Audit, "utf8");

  const stageHashes = {
    stage_01: sha256Text(stage01Md),
    stage_02: sha256Text(`${stage02Logic}\n${stage02View}`),
    stage_03: sha256Text(`${stage03Prep}\n${stage03Manifest}\n${names.stage03SnapshotDir}`),
    stage_04: sha256Text(`${stage04Brief}\n${stage04Audit}`),
    stage_05: sha256Text(`${stage05Report}\n${stage05Audit}`),
  };

  const review = latestArtifact(runId, "independent_review", ["approved"]);
  const reviewData: any = review ? parseJson(review.json_content, {}) : {
    verdict: "needs_human",
    summary: "尚未完成工作台独立审阅；导出包标记为 needs_human",
    reviewer_type: "human",
    reviewer_model: "human:pending",
  };
  const contractVersion = String(parseManifest(run.manifest_json, run).versions?.contract || "1.3.0");
  const semanticYaml = mapIndependentReviewToSemanticYaml({
    reviewData,
    stageHashes,
    contractVersion,
    producerId: String(s04.model_name || "producer"),
  });
  writeFileSync(path.join(exportDir, names.stage05SemanticReviewYaml), semanticYaml, "utf8");

  const files = [
    names.stage01Md,
    names.stage02LogicMd,
    names.stage02ViewYaml,
    names.stage03PrepMd,
    names.stage03ManifestYaml,
    names.stage03SnapshotDir,
    names.stage04BriefMd,
    names.stage04AuditYaml,
    names.stage05ReportMd,
    names.stage05AuditYaml,
    names.stage05SemanticReviewYaml,
    "run_manifest.yaml",
    "README.md",
  ];

  const manifest = {
    schema_name: "controlled_research_run_manifest",
    schema_version: "1.3.0",
    task_id: String(d01.task_id || `JTASK-${runId}`),
    run_id: `EXEC-${runId}`,
    parent_run_id: run.parent_run_id || null,
    workbench_run_id: runId,
    package_kind: "formal_pack",
    versions: {
      contract: contractVersion,
      ontology: "3.0.0",
      kb02: "2.0.0",
      kb03: "3.1.0",
      kb04: "1.0.0",
    },
    stages: {
      stage_01: {
        artifact: [names.stage01Md],
        hash: stageHashes.stage_01,
        source_hashes: {},
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
      },
      stage_02: {
        artifact: [names.stage02LogicMd, names.stage02ViewYaml],
        hash: stageHashes.stage_02,
        source_hashes: { stage_01: stageHashes.stage_01 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
      },
      stage_03: {
        artifact: [names.stage03PrepMd, names.stage03SnapshotDir, names.stage03ManifestYaml],
        hash: stageHashes.stage_03,
        source_hashes: { stage_02: stageHashes.stage_02 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
      },
      stage_04: {
        artifact: [names.stage04BriefMd, names.stage04AuditYaml],
        hash: stageHashes.stage_04,
        source_hashes: { stage_03: stageHashes.stage_03 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
      },
      stage_05: {
        artifact: [names.stage05ReportMd, names.stage05AuditYaml, names.stage05SemanticReviewYaml],
        hash: stageHashes.stage_05,
        source_hashes: { stage_04: stageHashes.stage_04 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
      },
    },
    validation_issues: [],
    validation_summary: {
      quality_pass: false,
      publishable: false,
      publish_status: "INCOMPLETE_CHAIN",
      note: "导出后由 validate_run 派生",
    },
  };
  writeFileSync(path.join(exportDir, "run_manifest.yaml"), YAML.stringify(manifest), "utf8");
  writeFileSync(
    path.join(exportDir, "README.md"),
    [
      `# ${names.theme} 正式发布包`,
      "",
      `workbench_run_id: ${runId}`,
      `package_kind: formal_pack`,
      `layout: ${names.dirName}`,
      "",
      "本目录由工作台一键导出，文件命名对齐正式中文包（类似 7:13）。",
      "发布状态以 `python3 governance/03_校验/validate_run.py <本目录>` 派生为准。",
      "",
      "## 产物",
      "",
      ...files.filter((item) => item !== "README.md").map((item) => `- ${item}`),
      "",
    ].join("\n"),
    "utf8",
  );

  const exportRel = configuredRoot
    ? path.join(formalRelBase, names.dirName)
    : path.join("instances", "00_本机运行", "formal", names.dirName);

  return { export_dir: exportDir, export_rel: exportRel, names, files };
}

export type FormalPublishResult = FormalPackExportResult & {
  validate_ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  validation_summary: Record<string, unknown>;
};

export function publishFormalPackAndValidate(runId: string): FormalPublishResult {
  const exported = exportFormalPack(runId);
  const validator = repositoryPath("governance", "03_校验", "validate_run.py");
  if (!existsSync(validator)) throw new Error(`找不到校验器: ${validator}`);

  const result = spawnSync("python3", [validator, exported.export_dir, "--no-write"], {
    cwd: repositoryPath(),
    encoding: "utf8",
    env: process.env,
    timeout: 180_000,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = { ok: false, error: stdout.slice(0, 2000) || stderr.slice(0, 2000) };
  }

  const publishStatus = String(
    parsed?.validation_summary?.publish_status
    || parsed?.publish_status
    || (result.status === 0 ? "STAGE_READY" : "RETURN_REQUIRED"),
  );
  const publishable = Boolean(parsed?.validation_summary?.publishable || parsed?.publishable);
  const validateOk = result.status === 0 && (parsed.ok !== false);

  const validation_summary = {
    quality_pass: Boolean(parsed?.validation_summary?.quality_pass ?? validateOk),
    publishable,
    publish_status: publishStatus,
    package_kind: "formal_pack",
    validator: "governance/03_校验/validate_run.py",
    exit_code: result.status,
    checked_at: new Date().toISOString(),
    export_rel: exported.export_rel,
    export_dir: exported.export_dir,
    error: parsed.error || null,
    errors: parsed.errors || parsed.validation_issues || [],
    stderr_tail: stderr.slice(-2000),
    stdout_tail: stdout.slice(-2000),
  };

  const run = getRun(runId)!;
  const manifest = parseManifest(run.manifest_json, run);
  manifest.validation_summary = {
    quality_pass: validation_summary.quality_pass,
    publishable,
    publish_status: publishStatus,
  };
  updateRun(runId, {
    status: publishable ? "published" : run.status,
    manifest_json: JSON.stringify(manifest),
  });

  return {
    ...exported,
    validate_ok: validateOk,
    exit_code: result.status,
    stdout,
    stderr,
    validation_summary,
  };
}
