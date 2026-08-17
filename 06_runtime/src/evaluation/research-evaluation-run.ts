import { createHash } from "node:crypto";
import type { ResearchEvaluationRun } from "@/src/contracts/knowledge";
import { evaluateFormalCaseEligibility, type FormalEvaluationCaseManifest } from "@/src/evaluation/formal-case-eligibility";

export interface ResearchEvaluationRunStore {
  knowledge: {
    putResearchEvaluationRun(
      input: Omit<ResearchEvaluationRun, "id" | "createdAt"> & { id?: string; createdAt?: string },
    ): ResearchEvaluationRun;
  };
}

export interface FrozenEvaluationArtifact {
  ref: string;
  payload: unknown;
  frozenAt: string;
  modelId?: string;
}

export interface PrepareResearchEvaluationRunInput {
  manifest: FormalEvaluationCaseManifest;
  systemArtifact: FrozenEvaluationArtifact;
  baselines: [FrozenEvaluationArtifact, FrozenEvaluationArtifact];
  judges?: ResearchEvaluationRun["judgeVersions"];
}

export interface PreparedResearchEvaluationRun {
  run: ResearchEvaluationRun;
  systemArtifactHash: string;
  baselineHashes: Array<{ track: "direct_qa" | "evidence_summary"; artifactHash: string }>;
  formalEligibility: ReturnType<typeof evaluateFormalCaseEligibility>;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function prepareResearchEvaluationRun(store: ResearchEvaluationRunStore, input: PrepareResearchEvaluationRunInput): PreparedResearchEvaluationRun {
  const baselineTracks: Array<"direct_qa" | "evidence_summary"> = ["direct_qa", "evidence_summary"];
  const artifactTimes = [input.systemArtifact, ...input.baselines].map((item) => Date.parse(item.frozenAt));
  if (artifactTimes.some((value) => !Number.isFinite(value))) throw new Error("Evaluation artifacts require ISO frozenAt timestamps");
  if (input.baselines.some((item) => !item.ref.trim())) throw new Error("Evaluation baselines require stable refs");
  if (!input.systemArtifact.ref.trim()) throw new Error("System artifact requires a stable ref");
  const systemArtifactHash = sha256(input.systemArtifact.payload);
  const baselineArtifacts = input.baselines.map((artifact, index) => ({
    track: baselineTracks[index], ref: artifact.ref, artifactHash: sha256(artifact.payload), modelId: artifact.modelId,
  }));
  const formalEligibility = evaluateFormalCaseEligibility(input.manifest);
  const evidenceFrozenAt = Date.parse(input.manifest.evidenceBundle.frozenAt);
  const chronologyNotes = [
    evidenceFrozenAt <= Date.parse(input.systemArtifact.frozenAt) ? "evidence precedes system artifact" : "invalid chronology: system artifact predates evidence",
    formalEligibility.status === "eligible" ? "formal eligibility attested" : `formal eligibility pending: ${formalEligibility.checks.filter((item) => !item.passed).map((item) => item.id).join(",")}`,
  ];
  const run = store.knowledge.putResearchEvaluationRun({
    caseId: input.manifest.caseId,
    protocolVersion: input.manifest.schemaVersion,
    status: evidenceFrozenAt <= Date.parse(input.systemArtifact.frozenAt) ? "prepared" : "invalid",
    taskInputHash: sha256(input.manifest.taskInput),
    evidenceBundleHash: input.manifest.evidenceBundle.hash,
    systemArtifact: { ref: input.systemArtifact.ref, artifactHash: systemArtifactHash, frozenAt: new Date(input.systemArtifact.frozenAt).toISOString() },
    baselineArtifacts,
    judgeVersions: input.judges || [],
    formalScoreEligible: formalEligibility.status === "eligible",
    metrics: {},
    notes: chronologyNotes,
  });
  return { run, systemArtifactHash, baselineHashes: baselineArtifacts.map(({ track, artifactHash }) => ({ track, artifactHash })), formalEligibility };
}
