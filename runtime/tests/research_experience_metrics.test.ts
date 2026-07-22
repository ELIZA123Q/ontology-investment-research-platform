import { describe, expect, it } from "vitest";
import { computeResearchExperienceMetrics } from "@/engine/research_experience_metrics";

const baseTime = "2026-07-22T00:00:00.000Z";

function artifact(kind: string, version = 1, data: Record<string, unknown> = {}, approvedAt = "2026-07-22T01:00:00.000Z") {
  return {
    id: `${kind}-${version}`,
    run_id: "run-1",
    kind,
    version,
    status: "approved",
    json_content: JSON.stringify(data),
    markdown_content: "",
    model_name: "test-model",
    prompt_version: "test",
    knowledge_version: "test",
    input_context: "",
    raw_model_output: "",
    response_id: null,
    token_usage: JSON.stringify({ total_tokens: 100 }),
    tool_usage: "{}",
    error_message: null,
    created_at: approvedAt,
    approved_at: approvedAt,
  } as any;
}

function job(id: string, result: Record<string, unknown>, attempt = 1) {
  return {
    id,
    run_id: "run-1",
    job_type: "generate_artifact",
    stage: "stage_03",
    artifact_id: null,
    status: "waiting_for_review",
    dedupe_key: id,
    lease_token: null,
    worker_id: null,
    lease_expires_at: null,
    heartbeat_at: null,
    attempt,
    max_attempts: 3,
    available_at: baseTime,
    budget_json: "{}",
    input_artifacts_json: "[]",
    input_hash: "sha256:test",
    payload_json: JSON.stringify({ mode: "evidence_supplement" }),
    result_json: JSON.stringify(result),
    last_error: null,
    queued_at: baseTime,
    started_at: "2026-07-22T00:10:00.000Z",
    finished_at: "2026-07-22T00:20:00.000Z",
    created_at: baseTime,
    updated_at: "2026-07-22T00:20:00.000Z",
  } as any;
}

function event(eventType: string, outcome: string, occurredAt: string) {
  return {
    id: `${eventType}-${outcome}-${occurredAt}`,
    run_id: "run-1",
    event_type: eventType,
    actor_type: eventType === "run_created" ? "human" : "human",
    stage: "stage_03",
    target_type: "Artifact",
    target_id: "target",
    outcome,
    payload_json: "{}",
    dedupe_key: `${eventType}:${outcome}:${occurredAt}`,
    occurred_at: occurredAt,
  } as any;
}

describe("research experience metrics", () => {
  it("measures elapsed time, human work, first-pass completion, supplementation and cost inputs", () => {
    const stages = [1, 2, 3, 4, 5].map((number) => artifact(
      `stage_0${number}`,
      1,
      number === 4 ? { judgments: [{ strength: "J2", decision_status: "supported" }] } : {},
      number === 4 ? "2026-07-22T02:00:00.000Z" : `2026-07-22T0${number}:00:00.000Z`,
    ));
    const metrics = computeResearchExperienceMetrics({
      run: {
        id: "run-1", question: "测试", domain: "semiconductor", current_stage: 5, status: "complete",
        package_path: null, parent_run_id: null, trigger_event_id: null, trigger_classification: null,
        manifest_json: "{}", created_at: baseTime, updated_at: "2026-07-22T05:00:00.000Z",
      },
      artifacts: [...stages, artifact("independent_review", 1, { verdict: "pass" })],
      workItems: [],
      jobs: [job("supplement-hit", { new_source_count: 2 }, 2), job("supplement-miss", { new_source_count: 0 })],
      events: [
        event("run_created", "new_research_created", baseTime),
        event("work_item_decision", "approved", "2026-07-22T00:30:00.000Z"),
        event("work_item_decision", "rework", "2026-07-22T00:40:00.000Z"),
        event("stage_revision_completed", "revised", "2026-07-22T00:50:00.000Z"),
      ],
    } as any);

    expect(metrics.measurement_status).toBe("complete");
    expect(metrics.first_usable_conclusion).toMatchObject({ reached: true, minutes: 120, disposition: "directional" });
    expect(metrics.human_work).toMatchObject({ stage_confirmations: 5, object_decisions: 2, rework_decisions: 1, stage_revisions: 1, total_recorded_actions: 8 });
    expect(metrics.first_pass_completion).toMatchObject({ eligible: true, passed: false, stages_approved_on_first_attempt: 5 });
    expect(metrics.evidence_supplement).toMatchObject({ attempts: 2, measured_outcomes: 2, hits: 1, hit_rate: 0.5 });
    expect(metrics.execution).toMatchObject({ ai_elapsed_minutes: 20, retry_count: 1, current_artifact_tokens: 600 });
    expect(metrics.quality_guardrails).toMatchObject({ approved_judgment_count: 1, correct_stop_count: 0, independent_review_passed: true });
  });

  it("marks historical runs partial and recognizes an explicit J0 correct stop", () => {
    const metrics = computeResearchExperienceMetrics({
      run: {
        id: "run-1", question: "测试", domain: "semiconductor", current_stage: 4, status: "in_progress",
        package_path: null, parent_run_id: null, trigger_event_id: null, trigger_classification: null,
        manifest_json: "{}", created_at: baseTime, updated_at: "2026-07-22T02:00:00.000Z",
      },
      artifacts: [artifact("stage_04", 1, {
        judgments: [
          { strength: "J0", decision_status: "indeterminate" },
          { strength: "J0", decision_status: "blocked" },
        ],
      }, "2026-07-22T02:00:00.000Z")],
      workItems: [],
      jobs: [],
      events: [],
    } as any);

    expect(metrics.measurement_status).toBe("partial");
    expect(metrics.first_usable_conclusion).toMatchObject({ minutes: 120, disposition: "correct_stop" });
    expect(metrics.first_pass_completion).toMatchObject({ eligible: false, passed: null });
    expect(metrics.quality_guardrails).toMatchObject({ approved_judgment_count: 2, correct_stop_count: 2, independent_review_passed: null });
  });
});
