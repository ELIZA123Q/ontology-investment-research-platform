import type { ArtifactKind, ResearchRun } from "./types";

export const RESEARCH_STAGE_KINDS = [
  "stage_01",
  "stage_02",
  "stage_03",
  "stage_04",
  "stage_05",
] as const satisfies readonly ArtifactKind[];

export type ResearchStageKind = (typeof RESEARCH_STAGE_KINDS)[number];

export type RunProgress = {
  approved_stages: ResearchStageKind[];
  current_stage: number;
  completed_stage_count: number;
  contiguous_stage_count: number;
  is_contiguous: boolean;
};

function stageNumber(kind: string): number {
  const match = /^stage_0([1-5])$/.exec(kind);
  return match ? Number(match[1]) : 0;
}

/**
 * Progress is a projection of currently approved stage artifacts.
 * research_runs.current_stage and the manifest are caches/audit records, not
 * independent truth sources for researcher-facing screens.
 */
export function deriveRunProgress(approvedKinds: Iterable<string>): RunProgress {
  const approvedNumbers = [...new Set([...approvedKinds].map(stageNumber).filter(Boolean))]
    .sort((left, right) => left - right);
  let contiguous = 0;
  for (const stage of approvedNumbers) {
    if (stage !== contiguous + 1) break;
    contiguous = stage;
  }
  return {
    approved_stages: approvedNumbers.map((stage) => `stage_0${stage}` as ResearchStageKind),
    current_stage: approvedNumbers.at(-1) || 0,
    completed_stage_count: approvedNumbers.length,
    contiguous_stage_count: contiguous,
    is_contiguous: contiguous === (approvedNumbers.at(-1) || 0),
  };
}

export function projectRunStatus(status: ResearchRun["status"], progress: RunProgress): ResearchRun["status"] {
  if (status === "archived") return status;
  if (progress.current_stage >= 5) return "complete";
  if (progress.current_stage > 0 && (status === "draft" || status === "complete" || status === "completed")) {
    return "in_progress";
  }
  return status;
}
