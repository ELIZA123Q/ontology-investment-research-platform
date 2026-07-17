import "server-only";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getRun, listArtifacts, listSources, latestArtifact, updateRun } from "./db";
import { repositoryPath } from "./repo-paths";
import { loadGraphForRun } from "../engine/instance_graph";
import { parseManifest } from "../engine/manifest";
import { parseJson } from "../engine/types";

export type PublishResult = {
  export_dir: string;
  export_rel: string;
  validate_ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  validation_summary: Record<string, unknown>;
};

function stageFiles(runId: string, exportDir: string) {
  const written: string[] = [];
  for (const stage of ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"] as const) {
    const artifact = latestArtifact(runId, stage, ["approved", "needs_review"]);
    if (!artifact) continue;
    const data: any = parseJson(artifact.json_content, {});
    const mdName = `${stage}-${runId.slice(0, 8)}.md`;
    const jsonName = `${stage}-${runId.slice(0, 8)}.json`;
    writeFileSync(path.join(exportDir, mdName), artifact.markdown_content || data.document_markdown || `# ${stage}\n`, "utf8");
    writeFileSync(path.join(exportDir, jsonName), JSON.stringify(data, null, 2), "utf8");
    written.push(mdName, jsonName);
  }
  return written;
}

export function exportRunPackage(runId: string): { exportDir: string; exportRel: string; manifestPath: string } {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const exportRel = path.join("instances", "00_本机运行", "exports", runId);
  const exportDir = repositoryPath(exportRel);
  mkdirSync(exportDir, { recursive: true });

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

  const sources = listSources(runId);
  writeFileSync(path.join(exportDir, "sources.json"), JSON.stringify(sources, null, 2), "utf8");
  const stageWritten = stageFiles(runId, exportDir);

  const manifest = parseManifest(run.manifest_json, run);
  const exportManifest = {
    ...manifest,
    run_mode: "workbench",
    producer_id: "runtime-workbench-export",
    stages: Object.fromEntries(
      Object.entries(manifest.stages).map(([stage, entry]) => {
        const files = stageWritten.filter((name) => name.startsWith(stage));
        return [
          stage,
          {
            ...entry,
            artifact: files.length ? files : entry.artifact,
          },
        ];
      }),
    ),
    validation_summary: {
      ...manifest.validation_summary,
      publishable: false,
      publish_status: "exported_pending_validate",
    },
    export_meta: {
      exported_at: new Date().toISOString(),
      artifact_count: listArtifacts(runId).length,
      source_count: sources.length,
      graph_objects: loaded.graph.objects.length,
      graph_authority: loaded.authority,
    },
  };
  const manifestPath = path.join(exportDir, "run_manifest.yaml");
  writeFileSync(manifestPath, YAML.stringify(exportManifest), "utf8");
  writeFileSync(path.join(exportDir, "README.md"), `# Workbench export\n\nrun_id: ${runId}\n\n此目录由工作台导出，默认不可直接作为正式发布包。请运行 validate_run 查看缺口。\n`, "utf8");
  return { exportDir, exportRel, manifestPath };
}

export function publishAndValidate(runId: string): PublishResult {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const { exportDir, exportRel } = exportRunPackage(runId);
  const validator = repositoryPath("governance", "03_校验", "validate_run.py");
  if (!existsSync(validator)) throw new Error(`找不到校验器: ${validator}`);

  const result = spawnSync("python3", [validator, exportDir, "--no-write"], {
    cwd: repositoryPath(),
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const validateOk = result.status === 0;
  const validation_summary = {
    quality_pass: validateOk,
    publishable: false,
    publish_status: validateOk ? "validate_passed_workbench_export" : "validate_failed_workbench_export",
    exit_code: result.status,
    checked_at: new Date().toISOString(),
    export_rel: exportRel,
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
