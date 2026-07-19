import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { Artifact, ResearchRun } from "./types";

export type RunManifest = {
  schema_name: "controlled_research_run_manifest";
  schema_version: "1.2.0" | "1.3.0";
  task_id: string;
  run_id: string;
  parent_run: null | { run_id: string; manifest_ref: string; manifest_hash: string };
  run_mode: "workbench";
  producer_id: string;
  versions: Record<string, string>;
  stages: Record<string, StageManifestEntry>;
  reasoning_loop: {
    mode: "ontology_evidence_wave";
    latest_wave_ref: null;
    classification: string | null;
    pending_stage_attempts: string[];
    converged: boolean;
    notes: string[];
  };
  validation_summary: {
    quality_pass: boolean | null;
    publishable: boolean;
    publish_status: string;
  };
};

type StageManifestEntry = {
  artifact: string[];
  hash: string;
  source_hashes: Record<string, string>;
  stage_status: string;
  validity_status: string;
  attempt: number;
  supersedes_attempt: number | null;
  attempt_history: Array<Record<string, unknown>>;
  pending_attempt: null | Record<string, unknown>;
};

function blankStage(): StageManifestEntry {
  return {
    artifact: [],
    hash: "",
    source_hashes: {},
    stage_status: "not_started",
    validity_status: "missing",
    attempt: 1,
    supersedes_attempt: null,
    attempt_history: [],
    pending_attempt: null,
  };
}

export function createEmptyManifest(run: ResearchRun): RunManifest {
  const templatePath = repositoryPath("runtime", "engine", "templates", "run_manifest.template.yaml");
  const template = YAML.parse(readFileSync(templatePath, "utf8")) as RunManifest;
  return {
    ...template,
    schema_name: "controlled_research_run_manifest",
    schema_version: "1.3.0",
    task_id: `JTASK-WB-${run.id.slice(0, 8)}`,
    run_id: run.id,
    parent_run: null,
    run_mode: "workbench",
    producer_id: "runtime-workbench",
    stages: {
      stage_01: blankStage(),
      stage_02: blankStage(),
      stage_03: blankStage(),
      stage_04: blankStage(),
      stage_05: blankStage(),
    },
    reasoning_loop: {
      mode: "ontology_evidence_wave",
      latest_wave_ref: null,
      classification: null,
      pending_stage_attempts: [],
      converged: false,
      notes: ["workbench local run; not a publishable formal package"],
    },
    validation_summary: {
      quality_pass: null,
      publishable: false,
      publish_status: "workbench_only",
    },
  };
}

export function createChildManifest(
  run: ResearchRun,
  parent: ResearchRun,
  parentHash: string,
): RunManifest {
  const manifest = createEmptyManifest(run);
  return {
    ...manifest,
    parent_run: {
      run_id: parent.id,
      manifest_ref: `research_runs/${parent.id}/manifest`,
      manifest_hash: parentHash,
    },
    reasoning_loop: {
      ...manifest.reasoning_loop,
      classification: "external_event_update",
      notes: [
        ...manifest.reasoning_loop.notes,
        `parent_run:${parent.id}`,
        run.trigger_event_id ? `trigger_event:${run.trigger_event_id}` : "trigger_event:manual",
        `impact_classification:${run.trigger_classification || "evidence_update"}`,
      ],
    },
  };
}

export function parseManifest(raw: string | null | undefined, run: ResearchRun): RunManifest {
  if (!raw || raw === "{}" || raw === "") return createEmptyManifest(run);
  try {
    const parsed = JSON.parse(raw) as RunManifest;
    if (parsed.schema_name !== "controlled_research_run_manifest") return createEmptyManifest(run);
    if (!["1.2.0", "1.3.0"].includes(String(parsed.schema_version))) return createEmptyManifest(run);
    return parsed;
  } catch {
    return createEmptyManifest(run);
  }
}

export function recordApprovedStage(manifest: RunManifest, artifact: Artifact): RunManifest {
  if (!artifact.kind.startsWith("stage_")) return manifest;
  const stage = artifact.kind;
  const entry = manifest.stages[stage] || blankStage();
  const hash = `sha256:${createHash("sha256").update(artifact.json_content).digest("hex")}`;
  const historyItem = {
    attempt: entry.attempt,
    artifact_id: artifact.id,
    hash,
    approved_at: artifact.approved_at || new Date().toISOString(),
    status: "approved",
  };
  const nextEntry: StageManifestEntry = {
    ...entry,
    artifact: [artifact.id],
    hash,
    stage_status: "complete",
    validity_status: "current",
    attempt: entry.attempt,
    supersedes_attempt: entry.attempt > 1 ? entry.attempt - 1 : null,
    attempt_history: [...entry.attempt_history, historyItem],
    pending_attempt: null,
  };
  const stages = { ...manifest.stages, [stage]: nextEntry };
  const pending = Object.entries(stages)
    .filter(([, value]) => value.stage_status !== "complete")
    .map(([key]) => key);
  return {
    ...manifest,
    stages,
    reasoning_loop: {
      ...manifest.reasoning_loop,
      pending_stage_attempts: pending,
      converged: pending.length === 0,
      notes: [
        ...manifest.reasoning_loop.notes.filter((note) => !note.startsWith("last_approved:")),
        `last_approved:${stage}:${artifact.id}`,
      ],
    },
  };
}
