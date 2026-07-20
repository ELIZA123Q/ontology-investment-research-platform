import "server-only";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getRun, listArtifacts, listSources, listWorkItems, latestArtifact, updateRun } from "./db";
import { repositoryPath } from "./repo-paths";
import { loadGraphForRun } from "../engine/instance_graph";
import { evidenceBoundSources } from "../engine/evidence_sources";
import { parseManifest } from "../engine/manifest";
import { parseJson } from "../engine/types";
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
    stage_01: ["01_task.yaml"],
    stage_02: ["02_structure.yaml"],
    stage_03: ["03_evidence.yaml"],
    stage_04: ["04_judgment.yaml"],
    stage_05: ["05_expression.yaml", "05_report.md"],
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
      note: "工作台 Zod 投影；文件名对齐 V3 紧凑布局，不是正式发布包，也不是黄金样例。",
    }),
    "utf8",
  );
  writeFileSync(path.join(exportDir, "01_task.yaml"), YAML.stringify(projectTask(s01.data, manifest)), "utf8");
  writeFileSync(path.join(exportDir, "02_structure.yaml"), YAML.stringify(projectStructure(s02.data)), "utf8");
  writeFileSync(path.join(exportDir, "03_evidence.yaml"), YAML.stringify(projectEvidence(s03.data)), "utf8");
  writeFileSync(path.join(exportDir, "04_judgment.yaml"), YAML.stringify(projectJudgment(s04.data)), "utf8");
  writeFileSync(path.join(exportDir, "05_expression.yaml"), YAML.stringify(projectExpression(s05.data)), "utf8");
  writeFileSync(
    path.join(exportDir, "05_report.md"),
    s05.artifact?.markdown_content || s05.data.document_markdown || `# ${s05.data.title || "工作台报告"}\n`,
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
  for (const [kind, fileName] of [["independent_review", "independent_review.yaml"], ["baseline", "baseline.yaml"], ["evaluation", "evaluation.yaml"]] as const) {
    const artifact = latestArtifact(runId, kind, ["approved"]);
    if (!artifact) throw new Error(`导出缺少已确认产物 ${kind}`);
    writeFileSync(path.join(exportDir, fileName), YAML.stringify({
      artifact_id: artifact.id,
      artifact_version: artifact.version,
      model_name: artifact.model_name,
      content_hash: createHash("sha256").update(artifact.json_content).digest("hex"),
      json_content: artifact.json_content,
      content: parseJson(artifact.json_content, {}),
    }), "utf8");
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
  const review = latestArtifact(runId, "independent_review", ["approved"]);
  if (!review) throw new Error("独立审阅尚未确认，不能进入交付校验");
  const reviewData: any = parseJson(review.json_content, {});
  const judgment = latestArtifact(runId, "stage_04", ["approved"]);
  if (!judgment) throw new Error("阶段 04 尚未确认");
  const judgmentHash = createHash("sha256").update(judgment.json_content).digest("hex");
  if (reviewData.reviewed_stage04_artifact_id !== judgment.id || reviewData.reviewed_stage04_artifact_hash !== judgmentHash) {
    throw new Error("独立审阅已过期，不对应当前 stage_04");
  }
  if (reviewData.verdict !== "pass") throw new Error("独立审阅要求返工，不能进入交付校验");
  const independentModel = reviewData.independence_level === "independent_model"
    && reviewData.reviewer_type !== "human";
  const independentHuman = reviewData.independence_level === "independent_human"
    && reviewData.reviewer_type === "human"
    && String(reviewData.reviewer_model || "").startsWith("human:")
    && String(reviewData.reviewer_attestation || "").trim().length >= 20;
  if (!independentModel && !independentHuman) throw new Error("独立审阅身份或独立性声明不可验证，不能进入交付校验");
  if (!review.model_name || reviewData.reviewer_model !== review.model_name
    || reviewData.producer_model !== judgment.model_name || reviewData.reviewer_model === reviewData.producer_model) {
    throw new Error("独立审阅者身份无法从产物元数据验证");
  }
  const baseline = latestArtifact(runId, "baseline", ["approved"]);
  const evaluation = latestArtifact(runId, "evaluation", ["approved"]);
  const evidence = latestArtifact(runId, "stage_03", ["approved"]);
  if (!baseline || !evaluation || !evidence) throw new Error("发布前必须完成同证据基线和盲评");
  const evaluationData: any = parseJson(evaluation.json_content, {});
  const evidenceHash = createHash("sha256").update(evidence.json_content).digest("hex");
  if (evaluationData.baseline_artifact_id !== baseline.id || evaluationData.runtime_report_artifact_id !== report.id
    || evaluationData.frozen_stage03_artifact_id !== evidence.id || evaluationData.frozen_stage03_artifact_hash !== evidenceHash) {
    throw new Error("盲评已过期，不对应当前基线、报告或冻结证据");
  }
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
