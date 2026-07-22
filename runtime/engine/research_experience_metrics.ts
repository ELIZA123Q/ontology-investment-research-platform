import type { Artifact, ResearchExperienceEvent, ResearchJob, ResearchRun, ResearchWorkItem } from "./types";
import { parseJson, STAGES } from "./types";
import { summarizeTokenUsage } from "./research_job_budget";

export const RESEARCH_EXPERIENCE_METRICS_VERSION = "research-experience-metrics-v1";

export type ResearchExperienceMetrics = {
  metrics_version: string;
  measurement_status: "complete" | "partial";
  measurement_note: string;
  first_usable_conclusion: {
    reached: boolean;
    minutes: number | null;
    approved_at: string | null;
    disposition: "directional" | "correct_stop" | "unknown";
  };
  human_work: {
    stage_confirmations: number;
    object_decisions: number;
    total_recorded_actions: number;
    rework_decisions: number;
    stage_revisions: number;
  };
  first_pass_completion: {
    eligible: boolean;
    passed: boolean | null;
    stages_approved_on_first_attempt: number;
    required_stages: number;
  };
  evidence_supplement: {
    attempts: number;
    measured_outcomes: number;
    hits: number;
    hit_rate: number | null;
  };
  execution: {
    ai_elapsed_minutes: number;
    retry_count: number;
    current_artifact_tokens: number;
  };
  quality_guardrails: {
    approved_judgment_count: number;
    correct_stop_count: number;
    independent_review_passed: boolean | null;
  };
};

type Input = {
  run: ResearchRun;
  artifacts: Array<Pick<Artifact, "id" | "run_id" | "kind" | "version" | "status" | "json_content" | "token_usage" | "approved_at" | "created_at">>;
  workItems: Array<Pick<ResearchWorkItem, "id" | "run_id" | "status">>;
  jobs: ResearchJob[];
  events: ResearchExperienceEvent[];
};

function elapsedMinutes(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds / 600) / 100 : 0;
}

function stageNumber(kind: string) {
  return /^stage_0[1-5]$/.test(kind) ? Number(kind.slice(-1)) : 0;
}

export function computeResearchExperienceMetrics(input: Input): ResearchExperienceMetrics {
  const stageArtifacts = input.artifacts.filter((artifact) => stageNumber(artifact.kind) > 0);
  const approvedStageArtifacts = stageArtifacts.filter((artifact) => Boolean(artifact.approved_at));
  const firstJudgment = approvedStageArtifacts
    .filter((artifact) => artifact.kind === "stage_04")
    .sort((left, right) => String(left.approved_at).localeCompare(String(right.approved_at)))[0];
  const firstJudgmentData = parseJson<any>(firstJudgment?.json_content || "{}", {});
  const judgments = Array.isArray(firstJudgmentData.judgments) ? firstJudgmentData.judgments : [];
  const correctStop = judgments.length > 0 && judgments.every((judgment: any) =>
    String(judgment.strength || judgment.level || "J0") === "J0"
      && ["blocked", "indeterminate", "contested"].includes(String(judgment.decision_status || "")));

  const decisionEvents = input.events.filter((event) => event.event_type === "work_item_decision");
  const historicalTerminalItems = input.workItems.filter((item) => ["approved", "dismissed"].includes(item.status));
  const objectDecisions = decisionEvents.length || historicalTerminalItems.length;
  const stageRevisions = input.events.filter((event) => event.event_type === "stage_revision_completed").length;
  const reworkDecisions = decisionEvents.filter((event) => event.outcome === "rework").length;

  const currentApprovedByStage = new Map<string, Input["artifacts"][number]>();
  for (const stage of STAGES) {
    const artifact = approvedStageArtifacts
      .filter((item) => item.kind === stage && item.status === "approved")
      .sort((left, right) => right.version - left.version)[0];
    if (artifact) currentApprovedByStage.set(stage, artifact);
  }
  const firstAttemptStages = [...currentApprovedByStage.values()].filter((artifact) => artifact.version === 1).length;
  const completionEligible = input.run.current_stage >= 5 && currentApprovedByStage.size === STAGES.length;
  const anyRepeatedStageAttempt = STAGES.some((stage) => stageArtifacts.filter((artifact) => artifact.kind === stage).length > 1);

  const supplementJobs = input.jobs.filter((job) => parseJson<any>(job.payload_json || "{}", {}).mode === "evidence_supplement");
  const supplementOutcomes = supplementJobs
    .map((job) => parseJson<any>(job.result_json || "{}", {}))
    .filter((result) => Number.isFinite(Number(result.new_source_count)));
  const supplementHits = supplementOutcomes.filter((result) => Number(result.new_source_count) > 0).length;

  const aiElapsedMinutes = input.jobs.reduce((total, job) => {
    if (!job.started_at) return total;
    const end = job.finished_at || job.updated_at;
    return total + elapsedMinutes(job.started_at, end);
  }, 0);
  const currentArtifacts = [...new Map(
    input.artifacts
      .filter((artifact) => !["failed", "superseded"].includes(artifact.status))
      .sort((left, right) => left.version - right.version)
      .map((artifact) => [artifact.kind, artifact]),
  ).values()];
  const tokens = currentArtifacts.reduce((total, artifact) => total + summarizeTokenUsage(artifact.token_usage).total_tokens, 0);
  const independentReview = input.artifacts
    .filter((artifact) => artifact.kind === "independent_review" && artifact.status === "approved")
    .sort((left, right) => right.version - left.version)[0];
  const independentVerdict = independentReview
    ? String(parseJson<any>(independentReview.json_content, {}).verdict || "")
    : "";
  const hasEventCoverage = input.events.some((event) => event.event_type === "run_created");

  return {
    metrics_version: RESEARCH_EXPERIENCE_METRICS_VERSION,
    measurement_status: hasEventCoverage ? "complete" : "partial",
    measurement_note: hasEventCoverage
      ? "本 run 已启用追加式体验事件；指标可按定义复算。"
      : "该 run 早于体验事件台账；首次结论与阶段确认可测，历史返工只能部分还原。",
    first_usable_conclusion: {
      reached: Boolean(firstJudgment?.approved_at),
      minutes: firstJudgment?.approved_at ? elapsedMinutes(input.run.created_at, firstJudgment.approved_at) : null,
      approved_at: firstJudgment?.approved_at || null,
      disposition: !firstJudgment ? "unknown" : correctStop ? "correct_stop" : "directional",
    },
    human_work: {
      stage_confirmations: approvedStageArtifacts.length,
      object_decisions: objectDecisions,
      total_recorded_actions: approvedStageArtifacts.length + objectDecisions + stageRevisions,
      rework_decisions: reworkDecisions,
      stage_revisions: stageRevisions,
    },
    first_pass_completion: {
      eligible: completionEligible,
      passed: completionEligible ? firstAttemptStages === STAGES.length && !anyRepeatedStageAttempt && stageRevisions === 0 : null,
      stages_approved_on_first_attempt: firstAttemptStages,
      required_stages: STAGES.length,
    },
    evidence_supplement: {
      attempts: supplementJobs.length,
      measured_outcomes: supplementOutcomes.length,
      hits: supplementHits,
      hit_rate: supplementOutcomes.length ? supplementHits / supplementOutcomes.length : null,
    },
    execution: {
      ai_elapsed_minutes: Math.round(aiElapsedMinutes * 100) / 100,
      retry_count: input.jobs.reduce((total, job) => total + Math.max(0, job.attempt - 1), 0),
      current_artifact_tokens: tokens,
    },
    quality_guardrails: {
      approved_judgment_count: judgments.length,
      correct_stop_count: correctStop ? judgments.length : 0,
      independent_review_passed: independentReview ? independentVerdict === "pass" : null,
    },
  };
}
