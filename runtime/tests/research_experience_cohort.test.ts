import { describe, expect, it } from "vitest";
import {
  computeExperienceCohortSummary,
  deriveExperienceCaseProgress,
  parsePairedQualityMeasurement,
  type CohortCaseMeasurement,
  type PairedQualityMeasurement,
} from "@/engine/research_experience_cohort";
import type { ResearchExperienceMetrics } from "@/engine/research_experience_metrics";
import { EVALUATION_CRITERIA } from "@/engine/schemas";

function experience(overrides: Partial<ResearchExperienceMetrics> = {}): ResearchExperienceMetrics {
  return {
    metrics_version: "research-experience-metrics-v1",
    measurement_status: "complete",
    measurement_note: "complete",
    first_usable_conclusion: { reached: true, minutes: 60, approved_at: "2026-07-22T01:00:00Z", disposition: "directional" },
    human_work: { stage_confirmations: 5, object_decisions: 2, total_recorded_actions: 7, rework_decisions: 0, stage_revisions: 0 },
    first_pass_completion: { eligible: true, passed: true, stages_approved_on_first_attempt: 5, required_stages: 5 },
    evidence_supplement: { attempts: 1, measured_outcomes: 1, hits: 1, hit_rate: 1 },
    execution: { ai_elapsed_minutes: 10, retry_count: 0, current_artifact_tokens: 1000 },
    quality_guardrails: { approved_judgment_count: 1, correct_stop_count: 0, independent_review_passed: true },
    ...overrides,
  };
}

const quality = (delta = 0.5): PairedQualityMeasurement => ({
  baseline_score_mean: 3.5,
  runtime_score_mean: 3.5 + delta,
  score_delta: delta,
  criterion_deltas: Object.fromEntries(EVALUATION_CRITERIA.map((criterion) => [criterion, delta])),
  ontology_sensitive_score_delta: delta,
  traceable_claim_ratio: 1,
  judgment_method_trace_ratio: 1,
  rule_evaluation_count: 9,
  method_finalization_ratio: 1,
});

function completedCase(index: number, metric = experience(), paired: PairedQualityMeasurement | null = quality()): CohortCaseMeasurement {
  return { case_id: `RXB-S${String(index).padStart(2, "0")}`, status: "completed", run_id: `run-${index}`, experience: metric, paired_quality: paired };
}

describe("experience cohort aggregation", () => {
  it("keeps an empty cohort honest", () => {
    const summary = computeExperienceCohortSummary([], 8);
    expect(summary.primary.ttfc_minutes).toEqual({ count: 0, median: null, min: null, max: null });
    expect(summary.quality.guardrail_status).toBe("not_measured");
    expect(summary.workflow_gain_claim_status).toBe("insufficient_sample");
    expect(summary.ontology_value.contribution_status).toBe("insufficient_sample");
    expect(summary.analysis_ready).toBe(false);
  });

  it("requires quality completeness after the experience sample reaches eight", () => {
    const cases = Array.from({ length: 8 }, (_, index) => completedCase(index + 1, experience(), null));
    const summary = computeExperienceCohortSummary(cases, 8);
    expect(summary.measured_completed_count).toBe(8);
    expect(summary.analysis_ready_count).toBe(0);
    expect(summary.quality.guardrail_status).toBe("incomplete");
    expect(summary.workflow_gain_claim_status).toBe("quality_incomplete");
  });

  it("reports distributions but blocks a quality regression", () => {
    const cases = Array.from({ length: 8 }, (_, index) => completedCase(index + 1, experience({
      first_usable_conclusion: {
        reached: true,
        minutes: (index + 1) * 10,
        approved_at: "2026-07-22T01:00:00Z",
        disposition: index < 2 ? "correct_stop" : "directional",
      },
      first_pass_completion: { eligible: true, passed: index !== 7, stages_approved_on_first_attempt: index === 7 ? 4 : 5, required_stages: 5 },
    }), index === 7 ? quality(-0.5) : quality(0.5)));
    const summary = computeExperienceCohortSummary(cases, 8);
    expect(summary.primary.ttfc_minutes).toEqual({ count: 8, median: 45, min: 10, max: 80 });
    expect(summary.primary.directional_ttfc_minutes.count).toBe(6);
    expect(summary.primary.correct_stop_ttfc_minutes.count).toBe(2);
    expect(summary.primary.first_pass).toEqual({ eligible: 8, passed: 7, rate: 0.875 });
    expect(summary.analysis_ready).toBe(true);
    expect(summary.quality.guardrail_status).toBe("failed");
    expect(summary.workflow_gain_claim_status).toBe("quality_guardrail_failed");
    expect(summary.ontology_value.contribution_status).toBe("ready_for_provisional_contribution_analysis");
    expect(summary.ontology_value.ontology_sensitive_score_delta.median).toBe(0.5);
  });

  it("parses blinded A/B scores only after identity reveal", () => {
    const scores = Object.fromEntries(EVALUATION_CRITERIA.flatMap((criterion) => [
      [`A:${criterion}`, 3],
      [`B:${criterion}`, 4],
    ]));
    const parsed = parsePairedQualityMeasurement(JSON.stringify({
      revealed: true,
      side_a: "baseline",
      scores,
      metrics: { runtime: {
        traceable_claim_ratio: 0.8,
        judgment_method_trace_ratio: 1,
        rule_evaluation_count: 9,
        method_finalization_ratio: 1,
      } },
    }));
    expect(parsed).toMatchObject({
      baseline_score_mean: 3,
      runtime_score_mean: 4,
      score_delta: 1,
      ontology_sensitive_score_delta: 1,
      traceable_claim_ratio: 0.8,
      judgment_method_trace_ratio: 1,
      rule_evaluation_count: 9,
      method_finalization_ratio: 1,
    });
    expect(parsed?.criterion_deltas["结论边界"]).toBe(1);
    expect(parsePairedQualityMeasurement(JSON.stringify({ revealed: false, side_a: "baseline", scores }))).toBeNull();
  });

  it("gives each unfinished case one operational next step", () => {
    const base = {
      status: "completed" as const,
      run_id: "run-1",
      experience: experience(),
      baseline_status: "missing" as const,
      paired_quality: null,
    };
    expect(deriveExperienceCaseProgress({ ...base, status: "planned", run_id: null }).state).toBe("not_started");
    expect(deriveExperienceCaseProgress({ ...base, status: "running" }).state).toBe("research_in_progress");
    expect(deriveExperienceCaseProgress(base).state).toBe("baseline_needed");
    expect(deriveExperienceCaseProgress({ ...base, baseline_status: "needs_review" }).state).toBe("baseline_review_needed");
    expect(deriveExperienceCaseProgress({
      ...base,
      experience: experience({ quality_guardrails: { approved_judgment_count: 1, correct_stop_count: 0, independent_review_passed: null } }),
      baseline_status: "approved",
    }).state).toBe("independent_review_needed");
    expect(deriveExperienceCaseProgress({ ...base, baseline_status: "approved" }).state).toBe("paired_review_needed");
  });

  it("marks a fully measured quality failure analysis-ready without hiding it", () => {
    const progress = deriveExperienceCaseProgress({
      status: "completed",
      run_id: "run-1",
      experience: experience({ quality_guardrails: { approved_judgment_count: 1, correct_stop_count: 0, independent_review_passed: false } }),
      baseline_status: "approved",
      paired_quality: quality(-0.25),
    });
    expect(progress.state).toBe("analysis_ready_quality_failed");
    expect(progress.destination).toBe("report");
    expect(progress.checklist.independent_review).toBe("failed");
    expect(progress.checklist.paired_review).toBe("failed");
  });

  it("does not call a case complete when its experience events are partial", () => {
    const progress = deriveExperienceCaseProgress({
      status: "completed",
      run_id: "run-1",
      experience: experience({ measurement_status: "partial" }),
      baseline_status: "approved",
      paired_quality: quality(),
    });
    expect(progress.state).toBe("measurement_incomplete");
    expect(progress.checklist.experience).toBe("pending");
  });

  it("blocks ontology contribution when semantic execution measurements are incomplete", () => {
    const incomplete = quality();
    incomplete.rule_evaluation_count = null;
    const cases = Array.from({ length: 8 }, (_, index) => completedCase(index + 1, experience(), incomplete));
    const summary = computeExperienceCohortSummary(cases, 8);
    expect(summary.ontology_value.process_measured).toBe(0);
    expect(summary.ontology_value.contribution_status).toBe("execution_incomplete");
  });

  it("does not infer benefit when ontology-sensitive blind scores do not improve", () => {
    const neutral = quality(0);
    const cases = Array.from({ length: 8 }, (_, index) => completedCase(index + 1, experience(), neutral));
    const summary = computeExperienceCohortSummary(cases, 8);
    expect(summary.ontology_value.process_complete).toBe(8);
    expect(summary.ontology_value.contribution_status).toBe("no_observed_benefit");
  });
});
