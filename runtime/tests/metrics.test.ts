import { describe, expect, it } from "vitest";
import { runDifferenceAttribution } from "@/engine/metrics";
import type { Artifact, SourceRecord } from "@/engine/types";

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
});
