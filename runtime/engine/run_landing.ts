import type { ResearchJob, ResearchWorkItem } from "./types";
import type { RunProgress, ResearchStageKind } from "./run_progress";

export type RunLandingKind = "summary" | "stage_review" | "job" | "delivery_gate";

export type RunLandingState = {
  kind: RunLandingKind;
  href: string;
  stage?: ResearchStageKind;
  reason: string;
};

type ArtifactState = { kind: string; status: string; created_at?: string; approved_at?: string | null };
type WorkItemState = Pick<ResearchWorkItem, "stage" | "status" | "priority" | "created_at">;

const STAGE_PATH: Record<string, string> = {
  stage_01: "/scope",
  stage_02: "/structure",
  stage_03: "/evidence",
  stage_04: "/judgments",
  stage_05: "/report",
};

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retrying", "waiting_for_input", "blocked"]);

function stageHref(runId: string, stage: string) {
  return `/runs/${runId}${STAGE_PATH[stage] || "/scope"}`;
}

function latestByStage<T extends { stage: string; created_at: string }>(values: T[]) {
  const seen = new Set<string>();
  return [...values]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .filter((item) => {
      if (!item.stage || seen.has(item.stage)) return false;
      seen.add(item.stage);
      return true;
    });
}

export function resolveRunLanding(input: {
  runId: string;
  progress: RunProgress;
  artifacts: ArtifactState[];
  workItems: WorkItemState[];
  jobs: ResearchJob[];
  deliveryReady: boolean;
}): RunLandingState {
  const pending = input.workItems
    .filter((item) => item.status === "pending" || item.status === "rework")
    .sort((left, right) => (PRIORITY_RANK[right.priority] || 0) - (PRIORITY_RANK[left.priority] || 0)
      || Date.parse(right.created_at) - Date.parse(left.created_at));
  if (pending[0]) {
    const stage = pending[0].stage as ResearchStageKind;
    return { kind: "stage_review", stage, href: stageHref(input.runId, stage), reason: "存在待核对或退回事项" };
  }

  const latestArtifacts = new Map<string, ArtifactState>();
  for (const artifact of input.artifacts) {
    if (!latestArtifacts.has(artifact.kind)) latestArtifacts.set(artifact.kind, artifact);
  }
  const awaitingReview = [...latestArtifacts.values()]
    .filter((artifact) => artifact.status === "needs_review" && STAGE_PATH[artifact.kind])
    .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""))[0];
  if (awaitingReview) {
    const stage = awaitingReview.kind as ResearchStageKind;
    return { kind: "stage_review", stage, href: stageHref(input.runId, stage), reason: "阶段产物等待人工确认" };
  }

  const activeJob = latestByStage(input.jobs).find((job) => {
    if (!ACTIVE_JOB_STATUSES.has(job.status)) return false;
    const approved = input.artifacts
      .filter((artifact) => artifact.kind === job.stage && artifact.status === "approved")
      .sort((left, right) => Date.parse(right.approved_at || right.created_at || "") - Date.parse(left.approved_at || left.created_at || ""))[0];
    return !approved || Date.parse(job.updated_at || job.created_at) > Date.parse(approved.approved_at || approved.created_at || "");
  });
  if (activeJob) {
    const stage = activeJob.stage as ResearchStageKind;
    return { kind: "job", stage, href: stageHref(input.runId, stage), reason: "当前阶段存在进行中或受阻的生成任务" };
  }

  if (input.progress.completed_stage_count >= 5) {
    if (input.deliveryReady) return { kind: "summary", href: `/runs/${input.runId}`, reason: "研究已完成并满足交付条件" };
    return { kind: "delivery_gate", stage: "stage_05", href: `/runs/${input.runId}/report`, reason: "研究阶段已完成，但交付条件尚未全部满足" };
  }

  const nextStageNumber = Math.min(5, Math.max(1, input.progress.contiguous_stage_count + 1));
  const nextStage = `stage_0${nextStageNumber}` as ResearchStageKind;
  return { kind: "stage_review", stage: nextStage, href: stageHref(input.runId, nextStage), reason: "继续当前研究阶段" };
}
