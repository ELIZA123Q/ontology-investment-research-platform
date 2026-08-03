import "server-only";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getRun, listArtifacts, listSources, listWorkItems, latestArtifact, updateRun } from "./db";
import { repositoryPath } from "./repo-paths";
import { loadGraphForRun } from "../engine/instance_graph";
import { evidenceBoundSources } from "../engine/evidence_sources";
import { parseManifest } from "../engine/manifest";
import { parseJson } from "../engine/types";
import { loadApprovedSemanticSnapshot } from "../engine/semantic_reads";
import {
  buildWorkbenchManifest,
  projectEvidence,
  projectExpression,
  projectJudgment,
  projectStructure,
  projectTask,
} from "../engine/workbench_export";

export type PublishResult = {
  export_dir: string;
  export_rel: string;
  validate_ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  validation_summary: Record<string, unknown>;
};

function stageData(
  runId: string,
  stage: "stage_01" | "stage_02" | "stage_03" | "stage_04" | "stage_05",
  approvedOnly: boolean,
) {
  if (approvedOnly && ["stage_02", "stage_03", "stage_04"].includes(stage)) {
    const snapshot = loadApprovedSemanticSnapshot(
      runId,
      stage as "stage_02" | "stage_03" | "stage_04",
    );
    return { artifact: snapshot.artifact, data: snapshot.data };
  }
  const artifact = latestArtifact(runId, stage, approvedOnly ? ["approved"] : ["approved", "needs_review"]);
  if (!artifact) return { artifact: null, data: {} as Record<string, any> };
  return { artifact, data: parseJson<Record<string, any>>(artifact.json_content, {}) };
}

export function exportRunPackage(
  runId: string,
  options: { approvedOnly?: boolean } = {},
): { exportDir: string; exportRel: string; manifestPath: string } {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const configuredRoot = process.env.WORKBENCH_EXPORT_ROOT?.trim();
  const exportRel = configuredRoot
    ? path.join(path.resolve(configuredRoot), runId)
    : path.join("instances", "00_本机运行", "exports", runId);
  const exportDir = configuredRoot ? exportRel : repositoryPath(exportRel);
  mkdirSync(exportDir, { recursive: true });

  const manifest = parseManifest(run.manifest_json, run);
  const approvedOnly = Boolean(options.approvedOnly);
  const s01 = stageData(runId, "stage_01", approvedOnly);
  const s02 = stageData(runId, "stage_02", approvedOnly);
  const s03 = stageData(runId, "stage_03", approvedOnly);
  const s04 = stageData(runId, "stage_04", approvedOnly);
  const s05 = stageData(runId, "stage_05", approvedOnly);
  if (approvedOnly && [s01, s02, s03, s04, s05].some((stage) => !stage.artifact)) {
    throw new Error("发布导出要求 01—05 全部存在已确认产物");
  }

  const files = {
    stage_01: ["01_task.yaml", "01-投研需求说明.md"],
    stage_02: ["02_structure.yaml", "02-研究逻辑.md", "02-本体视图.yaml"],
    stage_03: ["03_evidence.yaml", "03-数据与证据准备.md", "03-语义域与证据域实例清单.yaml", "03-证据快照摘要.yaml"],
    stage_04: ["04_judgment.yaml", "04-判断简报.md", "04-推理审计.yaml"],
    stage_05: ["05_expression.yaml", "05-研究报告.md", "05_report.md", "05-表达审计.yaml"],
  };

  writeFileSync(
    path.join(exportDir, "package_kind.yaml"),
    YAML.stringify({
      package_kind: "workbench_export",
      layout: "compact_v3_yaml",
      validator: "governance/03_校验/validate_workbench_package.py",
      publishable: false,
      contract_ref: {
        schema_name: "controlled_research_run_manifest",
        schema_version: "1.3.0",
      },
      note: "工作台 Zod 投影；01—05 对齐规范双产物命名，不是正式发布包，也不是黄金样例。",
    }),
    "utf8",
  );
  writeFileSync(path.join(exportDir, "01_task.yaml"), YAML.stringify(projectTask(s01.data, manifest)), "utf8");
  writeFileSync(
    path.join(exportDir, "01-投研需求说明.md"),
    s01.artifact?.markdown_content || s01.data.document_markdown || "# 投研需求说明\n",
    "utf8",
  );
  writeFileSync(path.join(exportDir, "02_structure.yaml"), YAML.stringify(projectStructure(s02.data)), "utf8");
  writeFileSync(
    path.join(exportDir, "02-研究逻辑.md"),
    s02.artifact?.markdown_content || s02.data.research_logic_markdown || s02.data.document_markdown || "# 研究逻辑\n",
    "utf8",
  );
  writeFileSync(
    path.join(exportDir, "02-本体视图.yaml"),
    String(s02.data.ontology_view_yaml || YAML.stringify(projectStructure(s02.data))),
    "utf8",
  );
  writeFileSync(path.join(exportDir, "03_evidence.yaml"), YAML.stringify(projectEvidence(s03.data)), "utf8");
  writeFileSync(
    path.join(exportDir, "03-数据与证据准备.md"),
    s03.artifact?.markdown_content || s03.data.preparation_markdown || s03.data.document_markdown || "# 数据与证据准备\n",
    "utf8",
  );
  writeFileSync(
    path.join(exportDir, "03-语义域与证据域实例清单.yaml"),
    String(s03.data.instance_manifest_yaml || "document_type: cross_domain_runtime_instance_manifest\nnote: missing\n"),
    "utf8",
  );
  writeFileSync(
    path.join(exportDir, "03-证据快照摘要.yaml"),
    YAML.stringify({
      document_type: "evidence_snapshot_summary",
      snapshot_ref: s03.data.snapshot_ref || "03-证据快照摘要.yaml",
      sources_count: Array.isArray(s03.data.sources) ? s03.data.sources.length : 0,
      evidence_draft_count: Array.isArray(s03.data.evidence_drafts) ? s03.data.evidence_drafts.length : 0,
      unresolved_gaps: s03.data.unresolved_gaps || [],
      evidence_readiness: s03.data.evidence_readiness || null,
      delivery_readiness: s03.data.delivery_readiness || null,
      allowed_05_output: s03.data.allowed_05_output || null,
    }),
    "utf8",
  );
  writeFileSync(path.join(exportDir, "04_judgment.yaml"), YAML.stringify(projectJudgment(s04.data)), "utf8");
  writeFileSync(
    path.join(exportDir, "04-判断简报.md"),
    s04.artifact?.markdown_content || s04.data.judgment_brief_markdown || s04.data.document_markdown || "# 判断简报\n",
    "utf8",
  );
  writeFileSync(
    path.join(exportDir, "04-推理审计.yaml"),
    String(s04.data.reasoning_audit_yaml || "document_type: reasoning_audit\nnote: missing\n"),
    "utf8",
  );
  writeFileSync(path.join(exportDir, "05_expression.yaml"), YAML.stringify(projectExpression(s05.data)), "utf8");
  const stage05Report =
    s05.artifact?.markdown_content || s05.data.document_markdown || `# ${s05.data.title || "工作台报告"}\n`;
  writeFileSync(path.join(exportDir, "05-研究报告.md"), stage05Report, "utf8");
  writeFileSync(path.join(exportDir, "05_report.md"), stage05Report, "utf8");
  writeFileSync(
    path.join(exportDir, "05-表达审计.yaml"),
    String(s05.data.expression_audit_yaml || "document_type: expression_audit\nnote: missing\n"),
    "utf8",
  );

  const loaded = loadGraphForRun(runId, run.package_path);
  writeFileSync(
    path.join(exportDir, "business_instance_graph.yaml"),
    YAML.stringify({
      schema_name: "task_ontology_view",
      schema_version: "2.2.0",
      workbench_export: true,
      graph_source: loaded.source,
      graph_authority: loaded.authority,
      business_instance_graph: loaded.graph,
    }),
    "utf8",
  );

  // Only evidence-bound sources belong to a replayable research package.
  // Radar leads and failed search candidates remain in SQLite as audit data.
  const sources = evidenceBoundSources(listSources(runId), s03.data);
  writeFileSync(path.join(exportDir, "sources.json"), JSON.stringify(sources, null, 2), "utf8");
  const writeArtifactWrapper = (artifact: NonNullable<ReturnType<typeof latestArtifact>>, fileName: string) => {
    writeFileSync(path.join(exportDir, fileName), YAML.stringify({
      artifact_id: artifact.id,
      artifact_version: artifact.version,
      model_name: artifact.model_name,
      content_hash: createHash("sha256").update(artifact.json_content).digest("hex"),
      json_content: artifact.json_content,
      content: parseJson(artifact.json_content, {}),
    }), "utf8");
  };
  const review = latestArtifact(runId, "independent_review", ["approved"]);
  // 独立审阅仅作为可选评测材料保留，不再是 05 确认或导出的前置门。
  if (review) {
    writeArtifactWrapper(review, "independent_review.yaml");
  } else {
    const reviewPath = path.join(exportDir, "independent_review.yaml");
    if (existsSync(reviewPath)) unlinkSync(reviewPath);
  }

  // 同证据盲评是独立评测材料：仅在一整对历史产物都存在时随包保留，
  // 普通研究没有或只生成了一半时都不影响导出，也不能复用旧导出中的过期文件。
  const baseline = latestArtifact(runId, "baseline", ["approved"]);
  const evaluation = latestArtifact(runId, "evaluation", ["approved"]);
  if (baseline && evaluation) {
    writeArtifactWrapper(baseline, "baseline.yaml");
    writeArtifactWrapper(evaluation, "evaluation.yaml");
  } else {
    for (const fileName of ["baseline.yaml", "evaluation.yaml"]) {
      const artifactPath = path.join(exportDir, fileName);
      if (existsSync(artifactPath)) unlinkSync(artifactPath);
    }
  }

  const exportManifest = {
    ...buildWorkbenchManifest(manifest, files),
    export_meta: {
      exported_at: new Date().toISOString(),
      artifact_count: listArtifacts(runId).length,
      source_count: sources.length,
      graph_objects: loaded.graph.objects.length,
      graph_authority: loaded.authority,
      artifact_bindings: Object.fromEntries(
        [s01.artifact, s02.artifact, s03.artifact, s04.artifact, s05.artifact]
          .filter(Boolean)
          .map((artifact) => [artifact!.kind, {
            artifact_id: artifact!.id,
            content_hash: createHash("sha256").update(artifact!.json_content).digest("hex"),
          }]),
      ),
    },
  };
  const manifestPath = path.join(exportDir, "run_manifest.yaml");
  writeFileSync(manifestPath, YAML.stringify(exportManifest), "utf8");
  writeFileSync(
    path.join(exportDir, "README.md"),
    [
      `# Workbench export`,
      ``,
      `run_id: ${runId}`,
      `package_kind: workbench_export`,
      ``,
      `此目录是工作台紧凑导出（文件名对齐 V3），用 \`validate_workbench_package.py\` 校验。`,
      `不是正式发布包（\`validate_run.py\`），也不是黄金样例（\`validate_v3_samples.py\`）。`,
      ``,
    ].join("\n"),
    "utf8",
  );
  return { exportDir, exportRel, manifestPath };
}

export function publishAndValidate(runId: string): PublishResult {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const report = latestArtifact(runId, "stage_05", ["approved"]);
  if (!report) throw new Error("阶段 05 尚未确认，不能进入交付校验");
  const blockers = listWorkItems(runId).filter((item) => item.status === "pending" || item.status === "rework");
  if (blockers.length) throw new Error(`仍有 ${blockers.length} 个对象级工作项未完成，不能进入交付校验`);
  const { exportDir, exportRel } = exportRunPackage(runId, { approvedOnly: true });
  const validator = repositoryPath("governance", "03_校验", "validate_workbench_package.py");
  if (!existsSync(validator)) throw new Error(`找不到校验器: ${validator}`);

  const result = spawnSync("python3", [validator, exportDir, "--json"], {
    cwd: repositoryPath(),
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = {};
  }
  const validateOk = result.status === 0;
  const validation_summary = {
    quality_pass: validateOk,
    publishable: false,
    publish_status: validateOk ? "workbench_validate_passed" : "workbench_validate_failed",
    package_kind: "workbench_export",
    validator: "governance/03_校验/validate_workbench_package.py",
    exit_code: result.status,
    checked_at: new Date().toISOString(),
    export_rel: exportRel,
    error_count: parsed.error_count ?? null,
    errors: parsed.errors ?? [],
    stderr_tail: stderr.slice(-2000),
    stdout_tail: stdout.slice(-2000),
  };

  const manifest = parseManifest(run.manifest_json, run);
  manifest.validation_summary = {
    quality_pass: validation_summary.quality_pass,
    publishable: false,
    publish_status: String(validation_summary.publish_status),
  };
  updateRun(runId, { manifest_json: JSON.stringify(manifest) });

  if (!validateOk) {
    const errors = Array.isArray(parsed.errors) ? parsed.errors.join("；") : stderr.slice(-1000);
    throw new Error(`工作台交付校验失败: ${errors || "未知错误"}`);
  }

  return {
    export_dir: exportDir,
    export_rel: exportRel,
    validate_ok: validateOk,
    exit_code: result.status,
    stdout,
    stderr,
    validation_summary,
  };
}
