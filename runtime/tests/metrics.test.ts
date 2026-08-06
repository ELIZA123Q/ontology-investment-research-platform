import { describe, expect, it } from "vitest";
import { comparisonMetrics, runDifferenceAttribution } from "@/metrics";
import type { Artifact, SourceRecord } from "@/schemas/types";

function artifact(data: unknown, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact",
    run_id: "run",
    kind: "stage_04",
    version: 1,
    status: "approved",
    json_content: JSON.stringify(data),
    markdown_content: "",
    model_name: "gpt-test",
    prompt_version: "prompt-v1",
    knowledge_version: "knowledge-v1",
    input_context: "",
    raw_model_output: "",
    response_id: null,
    token_usage: "{}",
    tool_usage: "{}",
    error_message: null,
    created_at: "2026-07-17T00:00:00Z",
    approved_at: "2026-07-17T00:00:00Z",
    ...overrides,
  };
}

function source(url: string): SourceRecord {
  return {
    id: url,
    run_id: "run",
    normalized_url: url,
    url,
    title: url,
    publisher: "",
    published_at: null,
    accessed_at: "2026-07-17T00:00:00Z",
    source_type: "web",
    search_excerpt: "",
  };
}

describe("repeat-run attribution", () => {
  it("attributes judgment changes to evidence and method changes", () => {
    const previous = artifact({
      method_applications: [{ application_id: "MA-01", method_id: "kb04:A01", method_version: "1.0.0", status: "executed" }],
      judgments: [{ id: "C-01", judgment_unit_id: "JU-01", strength: "J1", conclusion: "观察" }],
    });
    const current = artifact({
      method_applications: [{ application_id: "MA-01", method_id: "kb04:A02", method_version: "1.0.0", status: "executed" }],
      judgments: [{ id: "C-01", judgment_unit_id: "JU-01", strength: "J2", conclusion: "有条件成立" }],
    });
    const result = runDifferenceAttribution(
      { stage04: previous, sources: [source("https://example.com/a")] },
      { stage04: current, sources: [source("https://example.com/b")] },
    );
    expect(result.causes).toEqual(expect.arrayContaining(["evidence_change", "method_change"]));
    expect(result.methods.changed).toHaveLength(1);
    expect(result.judgments.changed).toHaveLength(1);
  });

  it("marks unexplained judgment drift as model variation", () => {
    const previous = artifact({ method_applications: [], judgments: [{ id: "C-01", judgment_unit_id: "JU-01", strength: "J1", conclusion: "观察" }] });
    const current = artifact({ method_applications: [], judgments: [{ id: "C-01", judgment_unit_id: "JU-01", strength: "J2", conclusion: "成立" }] });
    const result = runDifferenceAttribution(
      { stage04: previous, sources: [] },
      { stage04: current, sources: [] },
    );
    expect(result.causes).toEqual(["model_variation"]);
  });

  it("detects changed source bodies even when the URL is unchanged", () => {
    const previousSource = { ...source("https://example.com/a"), content_hash: "a".repeat(64), usability_status: "usable" as const };
    const currentSource = { ...source("https://example.com/a"), content_hash: "b".repeat(64), usability_status: "usable" as const };
    const unchanged = artifact({ method_applications: [], judgments: [] });
    const result = runDifferenceAttribution(
      { stage04: unchanged, sources: [previousSource] },
      { stage04: unchanged, sources: [currentSource] },
    );
    expect(result.causes).toContain("evidence_change");
    expect(result.evidence.changed_sources).toHaveLength(1);
  });
});

describe("comparison metrics", () => {
  it("counts only claims with a closed fact, source snapshot, judgment, and executed-method trace", () => {
    const baseline = artifact({ core_claims: [], sources: [] }, { kind: "baseline" });
    const stage03 = artifact({ evidence_drafts: [{ id: "EV-1", role: "support", source_ids: ["SRC-1"] }] }, { kind: "stage_03" });
    const stage04 = artifact({
      judgments: [{ id: "J-1", supporting_evidence_draft_ids: ["EV-1"], counter_evidence_draft_ids: [], method_application_ids: ["MA-1"] }],
      method_applications: [{ application_id: "MA-1", status: "executed", capability_type: "adjudication" }],
      rule_evaluations: [
        { id: "RE-1", result: "pass" },
        { id: "RE-2", deterministic_result: { result: "blocked" } },
      ],
      competing_explanations: [{ id: "CE-1", status: "active" }],
    });
    const report = artifact({
      report_claims: [
        { id: "EX-1", judgment_ids: ["J-1"], evidence_draft_ids: ["EV-1"], source_ids: ["SRC-1"], method_application_ids: ["MA-1"] },
        { id: "EX-2", judgment_ids: ["J-1"], evidence_draft_ids: [], source_ids: ["SRC-1"], method_application_ids: ["MA-1"] },
      ],
      limitations: [],
    }, { kind: "stage_05" });
    const captured = {
      ...source("https://example.com/a"), id: "SRC-1", usability_status: "usable" as const,
      retrieval_status: "captured" as const, content_hash: "a".repeat(64), locator: "第1段",
      source_quote: "原文", quote_verified: true,
    };
    const unbound = { ...captured, id: "SRC-UNBOUND", normalized_url: "https://example.com/unbound", url: "https://example.com/unbound" };
    const metrics = comparisonMetrics(baseline, report, stage03, stage04, [captured, unbound]);
    expect(metrics.runtime.clickable_sources).toBe(1);
    expect(metrics.runtime.supported_claim_ratio).toBe(0.5);
    expect(metrics.runtime.traceable_claim_ratio).toBe(0.5);
    expect(metrics.runtime.counterevidence_fact_count).toBe(0);
    expect(metrics.runtime.active_competing_explanation_count).toBe(1);
    expect(metrics.runtime.method_finalization_ratio).toBe(1);
    expect(metrics.runtime.rule_evaluation_count).toBe(2);
    expect(metrics.runtime.blocking_rule_evaluation_count).toBe(1);
  });

  it("accepts the full judgment method chain when it includes one executed adjudication", () => {
    const baseline = artifact({ core_claims: [], sources: [] }, { kind: "baseline" });
    const stage03 = artifact({ evidence_drafts: [{ id: "EV-1", kind: "fact_draft", source_ids: ["SRC-1"] }] }, { kind: "stage_03" });
    const stage04 = artifact({
      judgments: [{
        id: "J-1",
        supporting_evidence_draft_ids: ["EV-1"],
        counter_evidence_draft_ids: [],
        method_application_ids: ["MA-STRUCT", "MA-EVID", "MA-ADJ"],
      }],
      method_applications: [
        { application_id: "MA-STRUCT", status: "executed", capability_type: "judgment_structure" },
        { application_id: "MA-EVID", status: "executed", capability_type: "evidence" },
        { application_id: "MA-ADJ", status: "executed", capability_type: "adjudication" },
      ],
    });
    const report = artifact({
      report_claims: [{
        judgment_ids: ["J-1"],
        evidence_draft_ids: ["EV-1"],
        source_ids: ["SRC-1"],
        method_application_ids: ["MA-STRUCT", "MA-EVID", "MA-ADJ"],
      }],
      limitations: [],
    }, { kind: "stage_05" });
    const captured = {
      ...source("https://example.com/a"), id: "SRC-1", usability_status: "usable" as const,
      retrieval_status: "captured" as const, content_hash: "a".repeat(64), locator: "第1段",
      source_quote: "原文", quote_verified: true,
    };

    const metrics = comparisonMetrics(baseline, report, stage03, stage04, [captured]);

    expect(metrics.runtime.traceable_claim_ratio).toBe(1);
  });

  it("does not count candidate URLs as captured or supported evidence", () => {
    const baseline = artifact({ core_claims: [], sources: [] }, { kind: "baseline" });
    const stage03 = artifact({ evidence_drafts: [{ id: "EV-1", role: "support", source_ids: ["SRC-1"] }] }, { kind: "stage_03" });
    const stage04 = artifact({ judgments: [{ id: "J-1", supporting_evidence_draft_ids: ["EV-1"], method_application_ids: ["MA-1"] }], method_applications: [{ application_id: "MA-1", status: "executed" }] });
    const report = artifact({ report_claims: [{ judgment_ids: ["J-1"], evidence_draft_ids: ["EV-1"], source_ids: ["SRC-1"], method_application_ids: ["MA-1"] }] }, { kind: "stage_05" });
    const candidate = { ...source("https://example.com/a"), id: "SRC-1", usability_status: "candidate" as const };
    const metrics = comparisonMetrics(baseline, report, stage03, stage04, [candidate]);
    expect(metrics.runtime.clickable_sources).toBe(0);
    expect(metrics.runtime.supported_claim_ratio).toBe(0);
  });

  it("counts an honest J0 path as traceable without pretending it is source-supported", () => {
    const baseline = artifact({ core_claims: [], sources: [] }, { kind: "baseline", token_usage: JSON.stringify({ prompt_tokens: 10, completion_tokens: 5 }) });
    const stage03 = artifact({ evidence_drafts: [{ id: "GAP-1", kind: "gap", source_ids: [] }] }, { kind: "stage_03" });
    const stage04 = artifact({
      judgments: [{ id: "J-1", strength: "J0", decision_status: "indeterminate", not_judgeable_reason: "缺少事实", supporting_evidence_draft_ids: [], counter_evidence_draft_ids: [], method_application_ids: ["MA-1"] }],
      method_applications: [{ application_id: "MA-1", status: "blocked", capability_type: "adjudication" }],
    });
    const report = artifact({
      report_claims: [{ judgment_ids: ["J-1"], evidence_draft_ids: [], source_ids: [], method_application_ids: ["MA-1"] }],
      limitations: [],
    }, { kind: "stage_05", token_usage: JSON.stringify({ prompt_tokens: 20, completion_tokens: 7 }) });
    const metrics = comparisonMetrics(baseline, report, stage03, stage04, []);
    expect(metrics.runtime.supported_claim_ratio).toBe(0);
    expect(metrics.runtime.traceable_claim_ratio).toBe(1);
    expect(metrics.runtime.judgment_method_trace_ratio).toBe(1);
    expect(metrics.runtime.tokens).toBe(27);
    expect(metrics.baseline.tokens).toBe(15);
  });
});
