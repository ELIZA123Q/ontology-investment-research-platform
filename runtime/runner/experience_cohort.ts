import { EVALUATION_CRITERIA } from "../schemas/schemas";
import type { ResearchExperienceMetrics } from "./experience_metrics";
import { parseJson } from "../schemas/types";

export type PairedQualityMeasurement = {
  baseline_score_mean: number;
  runtime_score_mean: number;
  score_delta: number;
  criterion_deltas: Record<string, number>;
  ontology_sensitive_score_delta: number;
  traceable_claim_ratio: number | null;
  judgment_method_trace_ratio: number | null;
  rule_evaluation_count: number | null;
  method_finalization_ratio: number | null;
};

export const ONTOLOGY_SENSITIVE_CRITERIA = [
  "无来源主张控制",
  "反证与竞争解释",
  "结论边界",
  "可复盘性",
] as const;

export type CohortCaseMeasurement = {
  case_id: string;
  status: "planned" | "enrolled" | "running" | "completed";
  run_id: string | null;
  experience: ResearchExperienceMetrics | null;
  paired_quality: PairedQualityMeasurement | null;
};

export type ExperienceCaseProgress = {
  state:
    | "not_started"
    | "research_in_progress"
    | "baseline_needed"
    | "baseline_review_needed"
    | "independent_review_needed"
    | "paired_review_needed"
    | "measurement_incomplete"
    | "analysis_ready"
    | "analysis_ready_quality_failed";
  label: string;
  detail: string;
  destination: "new_run" | "run" | "compare" | "judgments" | "report";
  checklist: {
    research: "pending" | "complete";
    experience: "pending" | "complete";
    independent_review: "pending" | "passed" | "failed";
    baseline: "pending" | "needs_review" | "complete";
    paired_review: "pending" | "passed" | "failed";
  };
};

type Distribution = {
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
};

export type ExperienceCohortSummary = {
  target_gate: number;
  completed_run_count: number;
  measured_completed_count: number;
  analysis_ready_count: number;
  analysis_ready: boolean;
  primary: {
    ttfc_minutes: Distribution;
    directional_ttfc_minutes: Distribution;
    correct_stop_ttfc_minutes: Distribution;
    recorded_actions: Distribution;
    first_pass: { eligible: number; passed: number; rate: number | null };
  };
  diagnostics: {
    total_rework: number;
    supplement_attempts: number;
    supplement_measured_outcomes: number;
    supplement_hits: number;
    supplement_hit_rate: number | null;
    ai_elapsed_minutes: Distribution;
  };
  cost: {
    current_artifact_tokens: Distribution;
    total_current_artifact_tokens: number;
  };
  quality: {
    independent_review_measured: number;
    independent_review_passed: number;
    paired_reviewed: number;
    paired_score_delta: Distribution;
    traceable_claim_ratio: Distribution;
    guardrail_status: "not_measured" | "incomplete" | "passed" | "failed";
  };
  ontology_value: {
    process_measured: number;
    process_complete: number;
    traceable_claim_ratio: Distribution;
    judgment_method_trace_ratio: Distribution;
    rule_evaluation_count: Distribution;
    method_finalization_ratio: Distribution;
    ontology_sensitive_score_delta: Distribution;
    contribution_status:
      | "insufficient_sample"
      | "execution_incomplete"
      | "execution_guardrail_failed"
      | "no_observed_benefit"
      | "ready_for_provisional_contribution_analysis";
  };
  workflow_gain_claim_status:
    | "insufficient_sample"
    | "quality_incomplete"
    | "quality_guardrail_failed"
    | "ready_for_provisional_analysis";
};

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function distribution(values: number[]): Distribution {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return { count: 0, median: null, min: null, max: null };
  const middle = Math.floor(finite.length / 2);
  const median = finite.length % 2
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2;
  return {
    count: finite.length,
    median: rounded(median),
    min: rounded(finite[0]),
    max: rounded(finite.at(-1)!),
  };
}

export function parsePairedQualityMeasurement(jsonContent: string): PairedQualityMeasurement | null {
  const data = parseJson<any>(jsonContent || "{}", {});
  if (data.revealed !== true || !["baseline", "runtime"].includes(String(data.side_a))) return null;
  const scores = data.scores || {};
  const sideScores = (side: "A" | "B") => EVALUATION_CRITERIA.map((criterion) => Number(scores[`${side}:${criterion}`]));
  const a = sideScores("A");
  const b = sideScores("B");
  if ([...a, ...b].some((value) => !Number.isFinite(value) || value < 1 || value > 5)) return null;
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const baseline = data.side_a === "baseline" ? mean(a) : mean(b);
  const runtime = data.side_a === "runtime" ? mean(a) : mean(b);
  const criterionDeltas = Object.fromEntries(EVALUATION_CRITERIA.map((criterion, index) => [
    criterion,
    rounded(data.side_a === "runtime" ? a[index] - b[index] : b[index] - a[index]),
  ]));
  const ontologySensitiveDelta = mean(ONTOLOGY_SENSITIVE_CRITERIA.map((criterion) => criterionDeltas[criterion]));
  const optionalMetric = (key: string) => {
    const raw = data.metrics?.runtime?.[key];
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? rounded(value) : null;
  };
  return {
    baseline_score_mean: rounded(baseline),
    runtime_score_mean: rounded(runtime),
    score_delta: rounded(runtime - baseline),
    criterion_deltas: criterionDeltas,
    ontology_sensitive_score_delta: rounded(ontologySensitiveDelta),
    traceable_claim_ratio: optionalMetric("traceable_claim_ratio"),
    judgment_method_trace_ratio: optionalMetric("judgment_method_trace_ratio"),
    rule_evaluation_count: optionalMetric("rule_evaluation_count"),
    method_finalization_ratio: optionalMetric("method_finalization_ratio"),
  };
}

export function deriveExperienceCaseProgress(input: {
  status: CohortCaseMeasurement["status"];
  run_id: string | null;
  experience: ResearchExperienceMetrics | null;
  baseline_status: "missing" | "needs_review" | "approved";
  paired_quality: PairedQualityMeasurement | null;
}): ExperienceCaseProgress {
  const researchComplete = input.status === "completed";
  const experienceComplete = input.experience?.measurement_status === "complete";
  const independentPassed = input.experience?.quality_guardrails.independent_review_passed ?? null;
  const checklist: ExperienceCaseProgress["checklist"] = {
    research: researchComplete ? "complete" : "pending",
    experience: experienceComplete ? "complete" : "pending",
    independent_review: independentPassed === null ? "pending" : independentPassed ? "passed" : "failed",
    baseline: input.baseline_status === "approved"
      ? "complete"
      : input.baseline_status === "needs_review"
        ? "needs_review"
        : "pending",
    paired_review: !input.paired_quality
      ? "pending"
      : input.paired_quality.score_delta < 0
        ? "failed"
        : "passed",
  };
  const result = (
    state: ExperienceCaseProgress["state"],
    label: string,
    detail: string,
    destination: ExperienceCaseProgress["destination"],
  ): ExperienceCaseProgress => ({ state, label, detail, destination, checklist });

  if (!input.run_id) {
    return result("not_started", "待开始", "创建前瞻任务并从第一步记录真实操作。", "new_run");
  }
  if (!researchComplete) {
    return result("research_in_progress", "完成研究主链", "继续到 Stage05 确认或正确停止终点。", "run");
  }
  if (input.baseline_status === "missing") {
    return result("baseline_needed", "生成同证据基线", "研究主链已完成；用已冻结证据生成直接对照。", "compare");
  }
  if (input.baseline_status === "needs_review") {
    return result("baseline_review_needed", "确认同证据基线", "核对基线没有使用冻结证据包外的信息。", "compare");
  }
  if (independentPassed === null) {
    return result("independent_review_needed", "完成独立审阅", "基线已冻结；还缺判断质量的独立核查。", "judgments");
  }
  if (!input.paired_quality) {
    return result("paired_review_needed", "完成 A/B 盲评", "让未参与产出的评价人评分，提交后才揭示方案身份。", "compare");
  }
  if (!experienceComplete) {
    return result("measurement_incomplete", "检查体验事件", "质量对照已齐全，但体验事件仍不完整，不能进入分母。", "run");
  }
  if (independentPassed === false || input.paired_quality.score_delta < 0) {
    return result("analysis_ready_quality_failed", "测量完整·质量未通过", "失败结果已保留在样本内，不能据此宣称流程增益。", "report");
  }
  return result("analysis_ready", "可进入配对分析", "体验、独立审阅和同证据盲评均已完整。", "report");
}

export function computeExperienceCohortSummary(
  cases: CohortCaseMeasurement[],
  targetGate: number,
): ExperienceCohortSummary {
  const completed = cases.filter((item) => item.status === "completed");
  const measured = completed.filter((item) => item.experience?.measurement_status === "complete");
  const experience = measured.map((item) => item.experience!);
  const fullyMeasured = measured.filter((item) =>
    item.experience?.quality_guardrails.independent_review_passed !== null && Boolean(item.paired_quality));
  const ttfc = experience.filter((item) => item.first_usable_conclusion.minutes !== null);
  const firstPass = experience.filter((item) => item.first_pass_completion.eligible);
  const supplementAttempts = experience.reduce((total, item) => total + item.evidence_supplement.attempts, 0);
  const supplementOutcomes = experience.reduce((total, item) => total + item.evidence_supplement.measured_outcomes, 0);
  const supplementHits = experience.reduce((total, item) => total + item.evidence_supplement.hits, 0);
  const independentMeasured = experience.filter((item) => item.quality_guardrails.independent_review_passed !== null);
  const paired = measured.flatMap((item) => item.paired_quality ? [item.paired_quality] : []);
  const ontologyProcessMeasured = paired.filter((item) => [
    item.traceable_claim_ratio,
    item.judgment_method_trace_ratio,
    item.rule_evaluation_count,
    item.method_finalization_ratio,
  ].every((value) => value !== null));
  const ontologyProcessComplete = ontologyProcessMeasured.filter((item) =>
    item.traceable_claim_ratio === 1
      && item.judgment_method_trace_ratio === 1
      && Number(item.rule_evaluation_count) > 0
      && item.method_finalization_ratio === 1);
  const independentFailed = independentMeasured.some((item) => item.quality_guardrails.independent_review_passed === false);
  const pairedFailed = paired.some((item) => item.score_delta < 0);
  const qualityStatus = !measured.length
    ? "not_measured"
    : fullyMeasured.length < measured.length
      ? "incomplete"
      : independentFailed || pairedFailed
        ? "failed"
        : "passed";
  const analysisReady = fullyMeasured.length >= targetGate;
  const workflowGainStatus = measured.length < targetGate
    ? "insufficient_sample"
    : fullyMeasured.length < targetGate || qualityStatus === "incomplete" || qualityStatus === "not_measured"
      ? "quality_incomplete"
      : qualityStatus === "failed"
        ? "quality_guardrail_failed"
        : "ready_for_provisional_analysis";
  const totalTokens = experience.reduce((total, item) => total + item.execution.current_artifact_tokens, 0);
  const ontologyOutcome = distribution(paired.map((item) => item.ontology_sensitive_score_delta));
  const ontologyContributionStatus = fullyMeasured.length < targetGate
    ? "insufficient_sample"
    : ontologyProcessMeasured.length < targetGate
      ? "execution_incomplete"
      : ontologyProcessComplete.length < targetGate
        ? "execution_guardrail_failed"
        : Number(ontologyOutcome.median) <= 0
          ? "no_observed_benefit"
          : "ready_for_provisional_contribution_analysis";

  return {
    target_gate: targetGate,
    completed_run_count: completed.length,
    measured_completed_count: measured.length,
    analysis_ready_count: fullyMeasured.length,
    analysis_ready: analysisReady,
    primary: {
      ttfc_minutes: distribution(ttfc.map((item) => item.first_usable_conclusion.minutes!)),
      directional_ttfc_minutes: distribution(ttfc
        .filter((item) => item.first_usable_conclusion.disposition === "directional")
        .map((item) => item.first_usable_conclusion.minutes!)),
      correct_stop_ttfc_minutes: distribution(ttfc
        .filter((item) => item.first_usable_conclusion.disposition === "correct_stop")
        .map((item) => item.first_usable_conclusion.minutes!)),
      recorded_actions: distribution(experience.map((item) => item.human_work.total_recorded_actions)),
      first_pass: {
        eligible: firstPass.length,
        passed: firstPass.filter((item) => item.first_pass_completion.passed === true).length,
        rate: firstPass.length
          ? firstPass.filter((item) => item.first_pass_completion.passed === true).length / firstPass.length
          : null,
      },
    },
    diagnostics: {
      total_rework: experience.reduce((total, item) =>
        total + item.human_work.rework_decisions + item.human_work.stage_revisions, 0),
      supplement_attempts: supplementAttempts,
      supplement_measured_outcomes: supplementOutcomes,
      supplement_hits: supplementHits,
      supplement_hit_rate: supplementOutcomes ? supplementHits / supplementOutcomes : null,
      ai_elapsed_minutes: distribution(experience.map((item) => item.execution.ai_elapsed_minutes)),
    },
    cost: {
      current_artifact_tokens: distribution(experience.map((item) => item.execution.current_artifact_tokens)),
      total_current_artifact_tokens: totalTokens,
    },
    quality: {
      independent_review_measured: independentMeasured.length,
      independent_review_passed: independentMeasured.filter((item) =>
        item.quality_guardrails.independent_review_passed === true).length,
      paired_reviewed: paired.length,
      paired_score_delta: distribution(paired.map((item) => item.score_delta)),
      traceable_claim_ratio: distribution(paired.flatMap((item) =>
        item.traceable_claim_ratio === null ? [] : [item.traceable_claim_ratio])),
      guardrail_status: qualityStatus,
    },
    ontology_value: {
      process_measured: ontologyProcessMeasured.length,
      process_complete: ontologyProcessComplete.length,
      traceable_claim_ratio: distribution(paired.flatMap((item) =>
        item.traceable_claim_ratio === null ? [] : [item.traceable_claim_ratio])),
      judgment_method_trace_ratio: distribution(paired.flatMap((item) =>
        item.judgment_method_trace_ratio === null ? [] : [item.judgment_method_trace_ratio])),
      rule_evaluation_count: distribution(paired.flatMap((item) =>
        item.rule_evaluation_count === null ? [] : [item.rule_evaluation_count])),
      method_finalization_ratio: distribution(paired.flatMap((item) =>
        item.method_finalization_ratio === null ? [] : [item.method_finalization_ratio])),
      ontology_sensitive_score_delta: ontologyOutcome,
      contribution_status: ontologyContributionStatus,
    },
    workflow_gain_claim_status: workflowGainStatus,
  };
}
