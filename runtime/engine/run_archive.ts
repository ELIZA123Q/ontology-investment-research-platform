import "server-only";

import { createHash } from "node:crypto";
import YAML from "yaml";
import { getArtifact, getRun, listArtifacts, listSources } from "@/adapters/db";
import { listArtifactLedger, type ArtifactLedgerRow } from "@/adapters/db_read_models";
import { loadGraphForRun } from "@/engine/instance_graph";
import { projectEvidence, projectExpression, projectJudgment, projectStructure, projectTask } from "@/engine/workbench_export";
import { parseManifest } from "@/engine/manifest";
import { evidenceBoundSources } from "@/engine/evidence_sources";
import { parseJson, type Artifact, type ArtifactKind, type ArtifactStatus } from "@/engine/types";

type StageKind = "stage_01" | "stage_02" | "stage_03" | "stage_04" | "stage_05";
type ArchiveEntrySource = "artifact_json" | "artifact_markdown" | "projected_yaml" | "derived_json" | "derived_yaml";

export type ArchiveFileEntry = {
  id: string;
  file_name: string;
  title: string;
  stage: string;
  artifact_id: string | null;
  artifact_kind: ArtifactKind | null;
  version: number | null;
  status: ArtifactStatus | null;
  mime: "text/markdown" | "application/json" | "application/yaml";
  source: ArchiveEntrySource;
};

export type RunArchive = {
  run_id: string;
  run_question: string;
  generated_at: string;
  files: ArchiveFileEntry[];
  summary: {
    total_files: number;
    stages: Record<string, number>;
  };
};

type FilePayload = {
  entry: ArchiveFileEntry;
  content: string;
};

function stageArtifacts(artifacts: Artifact[], kind: StageKind): Artifact[] {
  return artifacts
    .filter((item) => item.kind === kind)
    .sort((a, b) => b.version - a.version);
}

function selectPreferredArtifact(items: Artifact[]): Artifact | null {
  const approved = items.find((item) => item.status === "approved");
  if (approved) return approved;
  const review = items.find((item) => item.status === "needs_review");
  if (review) return review;
  const fallback = items.find((item) => item.status !== "failed");
  return fallback || null;
}

function stageProjection(kind: StageKind, data: Record<string, unknown>, runId: string): string {
  if (kind === "stage_01") {
    const run = getRun(runId);
    if (!run) return YAML.stringify({});
    const manifest = parseManifest(run.manifest_json, run);
    return YAML.stringify(projectTask(data, manifest));
  }
  if (kind === "stage_02") return YAML.stringify(projectStructure(data));
  if (kind === "stage_03") return YAML.stringify(projectEvidence(data));
  if (kind === "stage_04") return YAML.stringify(projectJudgment(data));
  return YAML.stringify(projectExpression(data));
}

function stageFileBase(kind: StageKind): { stage: string; yamlName: string; mdName: string; title: string } {
  return {
    stage_01: { stage: "01", yamlName: "01_task.yaml", mdName: "01_scope.md", title: "研究范围" },
    stage_02: { stage: "02", yamlName: "02_structure.yaml", mdName: "02_structure.md", title: "研究结构" },
    stage_03: { stage: "03", yamlName: "03_evidence.yaml", mdName: "03_evidence.md", title: "证据" },
    stage_04: { stage: "04", yamlName: "04_judgment.yaml", mdName: "04_judgment.md", title: "判断" },
    stage_05: { stage: "05", yamlName: "05_expression.yaml", mdName: "05_report.md", title: "报告表达" },
  }[kind];
}

function artifactFileId(artifact: Artifact, suffix: string): string {
  return `${artifact.id}:${suffix}`;
}

function buildStageFiles(runId: string, artifacts: Artifact[], kind: StageKind): FilePayload[] {
  const selected = selectPreferredArtifact(stageArtifacts(artifacts, kind));
  if (!selected) return [];
  const data = parseJson<Record<string, unknown>>(selected.json_content || "{}", {});
  const { stage, yamlName, mdName, title } = stageFileBase(kind);
  const files: FilePayload[] = [];
  files.push({
    entry: {
      id: artifactFileId(selected, "yaml"),
      file_name: yamlName,
      title: `${title}（投影）`,
      stage,
      artifact_id: selected.id,
      artifact_kind: selected.kind,
      version: selected.version,
      status: selected.status,
      mime: "application/yaml",
      source: "projected_yaml",
    },
    content: stageProjection(kind, data, runId),
  });
  files.push({
    entry: {
      id: artifactFileId(selected, "json"),
      file_name: `${stage}_${selected.kind}_v${selected.version}.json`,
      title: `${title}（原始 JSON）`,
      stage,
      artifact_id: selected.id,
      artifact_kind: selected.kind,
      version: selected.version,
      status: selected.status,
      mime: "application/json",
      source: "artifact_json",
    },
    content: JSON.stringify(data, null, 2),
  });
  if ((selected.markdown_content || "").trim()) {
    files.push({
      entry: {
        id: artifactFileId(selected, "md"),
        file_name: mdName,
        title: `${title}（Markdown）`,
        stage,
        artifact_id: selected.id,
        artifact_kind: selected.kind,
        version: selected.version,
        status: selected.status,
        mime: "text/markdown",
        source: "artifact_markdown",
      },
      content: selected.markdown_content,
    });
  }
  return files;
}

function buildSupplementalFiles(runId: string): FilePayload[] {
  const files: FilePayload[] = [];
  const artifacts = listArtifacts(runId);
  const graphArtifact = selectPreferredArtifact(
    artifacts.filter((item) => item.kind === "instance_graph").sort((a, b) => b.version - a.version),
  );
  const graph = loadGraphForRun(runId, getRun(runId)?.package_path || null);
  files.push({
    entry: {
      id: graphArtifact ? artifactFileId(graphArtifact, "graph") : "derived:business_instance_graph",
      file_name: "business_instance_graph.yaml",
      title: "正式关系图",
      stage: "附",
      artifact_id: graphArtifact?.id || null,
      artifact_kind: graphArtifact?.kind || null,
      version: graphArtifact?.version || null,
      status: graphArtifact?.status || null,
      mime: "application/yaml",
      source: "derived_yaml",
    },
    content: YAML.stringify({
      schema_name: "task_ontology_view",
      schema_version: "2.2.0",
      graph_source: graph.source,
      graph_authority: graph.authority,
      business_instance_graph: graph.graph,
    }),
  });

  const stage03 = selectPreferredArtifact(stageArtifacts(artifacts, "stage_03"));
  const boundSources = evidenceBoundSources(
    listSources(runId),
    parseJson(stage03?.json_content || "{}", {}),
  );
  files.push({
    entry: {
      id: "derived:sources",
      file_name: "sources.json",
      title: "证据绑定来源",
      stage: "附",
      artifact_id: stage03?.id || null,
      artifact_kind: stage03?.kind || null,
      version: stage03?.version || null,
      status: stage03?.status || null,
      mime: "application/json",
      source: "derived_json",
    },
    content: JSON.stringify(boundSources, null, 2),
  });

  for (const kind of ["independent_review", "baseline", "evaluation", "action_audit"] as const) {
    const selected = selectPreferredArtifact(
      artifacts.filter((item) => item.kind === kind).sort((a, b) => b.version - a.version),
    );
    if (!selected) continue;
    files.push({
      entry: {
        id: artifactFileId(selected, "json"),
        file_name: `${kind}.json`,
        title: kind,
        stage: "附",
        artifact_id: selected.id,
        artifact_kind: selected.kind,
        version: selected.version,
        status: selected.status,
        mime: "application/json",
        source: "artifact_json",
      },
      content: JSON.stringify(parseJson(selected.json_content, {}), null, 2),
    });
  }

  return files;
}

function selectPreferredLedger(items: ArtifactLedgerRow[]): ArtifactLedgerRow | null {
  const approved = items.find((item) => item.status === "approved");
  if (approved) return approved;
  const review = items.find((item) => item.status === "needs_review");
  if (review) return review;
  const fallback = items.find((item) => item.status !== "failed");
  return fallback || null;
}

function buildStageIndexEntries(kind: StageKind, ledger: ArtifactLedgerRow[]): ArchiveFileEntry[] {
  const selected = selectPreferredLedger(
    ledger.filter((item) => item.kind === kind).sort((a, b) => b.version - a.version),
  );
  if (!selected) return [];
  const { stage, yamlName, mdName, title } = stageFileBase(kind);
  const entries: ArchiveFileEntry[] = [
    {
      id: `${selected.id}:yaml`,
      file_name: yamlName,
      title: `${title}（投影）`,
      stage,
      artifact_id: selected.id,
      artifact_kind: selected.kind,
      version: selected.version,
      status: selected.status,
      mime: "application/yaml",
      source: "projected_yaml",
    },
    {
      id: `${selected.id}:json`,
      file_name: `${stage}_${selected.kind}_v${selected.version}.json`,
      title: `${title}（原始 JSON）`,
      stage,
      artifact_id: selected.id,
      artifact_kind: selected.kind,
      version: selected.version,
      status: selected.status,
      mime: "application/json",
      source: "artifact_json",
    },
  ];
  if (selected.has_markdown) {
    entries.push({
      id: `${selected.id}:md`,
      file_name: mdName,
      title: `${title}（Markdown）`,
      stage,
      artifact_id: selected.id,
      artifact_kind: selected.kind,
      version: selected.version,
      status: selected.status,
      mime: "text/markdown",
      source: "artifact_markdown",
    });
  }
  return entries;
}

function buildSupplementalIndexEntries(ledger: ArtifactLedgerRow[]): ArchiveFileEntry[] {
  const entries: ArchiveFileEntry[] = [];
  const graphArtifact = selectPreferredLedger(
    ledger.filter((item) => item.kind === "instance_graph").sort((a, b) => b.version - a.version),
  );
  entries.push({
    id: graphArtifact ? `${graphArtifact.id}:graph` : "derived:business_instance_graph",
    file_name: "business_instance_graph.yaml",
    title: "正式关系图",
    stage: "附",
    artifact_id: graphArtifact?.id || null,
    artifact_kind: graphArtifact?.kind || null,
    version: graphArtifact?.version || null,
    status: graphArtifact?.status || null,
    mime: "application/yaml",
    source: "derived_yaml",
  });

  const stage03 = selectPreferredLedger(
    ledger.filter((item) => item.kind === "stage_03").sort((a, b) => b.version - a.version),
  );
  entries.push({
    id: "derived:sources",
    file_name: "sources.json",
    title: "证据绑定来源",
    stage: "附",
    artifact_id: stage03?.id || null,
    artifact_kind: stage03?.kind || null,
    version: stage03?.version || null,
    status: stage03?.status || null,
    mime: "application/json",
    source: "derived_json",
  });

  for (const kind of ["independent_review", "baseline", "evaluation", "action_audit"] as const) {
    const selected = selectPreferredLedger(
      ledger.filter((item) => item.kind === kind).sort((a, b) => b.version - a.version),
    );
    if (!selected) continue;
    entries.push({
      id: `${selected.id}:json`,
      file_name: `${kind}.json`,
      title: kind,
      stage: "附",
      artifact_id: selected.id,
      artifact_kind: selected.kind,
      version: selected.version,
      status: selected.status,
      mime: "application/json",
      source: "artifact_json",
    });
  }
  return entries;
}

/**
 * Archive index only — no JSON/Markdown materialization.
 * File bodies stay lazy via getArchiveFilePayload / zip streaming.
 */
export function buildRunArchive(runId: string): RunArchive {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const ledger = listArtifactLedger(runId);
  const files = [
    ...buildStageIndexEntries("stage_01", ledger),
    ...buildStageIndexEntries("stage_02", ledger),
    ...buildStageIndexEntries("stage_03", ledger),
    ...buildStageIndexEntries("stage_04", ledger),
    ...buildStageIndexEntries("stage_05", ledger),
    ...buildSupplementalIndexEntries(ledger),
  ];
  const stages = files.reduce<Record<string, number>>((acc, item) => {
    acc[item.stage] = (acc[item.stage] || 0) + 1;
    return acc;
  }, {});
  return {
    run_id: runId,
    run_question: run.question,
    generated_at: new Date().toISOString(),
    files,
    summary: {
      total_files: files.length,
      stages,
    },
  };
}

export function getArchiveFilePayload(runId: string, fileId: string): FilePayload {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const artifacts = listArtifacts(runId);
  const allFiles = [
    ...buildStageFiles(runId, artifacts, "stage_01"),
    ...buildStageFiles(runId, artifacts, "stage_02"),
    ...buildStageFiles(runId, artifacts, "stage_03"),
    ...buildStageFiles(runId, artifacts, "stage_04"),
    ...buildStageFiles(runId, artifacts, "stage_05"),
    ...buildSupplementalFiles(runId),
  ];
  const found = allFiles.find((item) => item.entry.id === fileId);
  if (!found) throw new Error("档案文件不存在");
  return found;
}

export function getArtifactFormatContent(runId: string, artifactId: string, format: "json" | "md" | "yaml"): { content: string; filename: string; mime: string } {
  const artifact = getArtifact(artifactId);
  if (!artifact || artifact.run_id !== runId) throw new Error("稿件不存在");
  if (format === "md") {
    return {
      content: artifact.markdown_content || "",
      filename: `${artifact.kind}_v${artifact.version}.md`,
      mime: "text/markdown; charset=utf-8",
    };
  }
  if (format === "yaml") {
    const data = parseJson<Record<string, unknown>>(artifact.json_content || "{}", {});
    return {
      content: YAML.stringify(data),
      filename: `${artifact.kind}_v${artifact.version}.yaml`,
      mime: "application/yaml; charset=utf-8",
    };
  }
  return {
    content: JSON.stringify(parseJson<Record<string, unknown>>(artifact.json_content || "{}", {}), null, 2),
    filename: `${artifact.kind}_v${artifact.version}.json`,
    mime: "application/json; charset=utf-8",
  };
}

export function archiveDigest(archive: RunArchive): string {
  return createHash("sha256").update(JSON.stringify(archive.files)).digest("hex").slice(0, 12);
}
