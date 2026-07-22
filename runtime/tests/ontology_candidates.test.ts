import { describe, expect, it } from "vitest";
import {
  aggregateTaskLocalCandidates,
  extractTaskLocalCandidateOccurrences,
  ontologyCandidateKey,
} from "@/engine/ontology_candidates";

describe("task_local ontology candidates", () => {
  it("uses a stable semantic key and aggregates exact cross-run reuse", () => {
    expect(ontologyCandidateKey({ name: "折旧 强度", category: "Cost", variable_kind: "Observed" }))
      .toBe(ontologyCandidateKey({ name: "折旧强度！", category: "cost", variable_kind: "observed" }));
    const rows = ["run-1", "run-2"].map((runId, index) => ({
      run_id: runId,
      artifact_id: `artifact-${index + 1}`,
      artifact_version: 1,
      question: `研究问题 ${index + 1}`,
      domain: "semiconductor",
      created_at: `2026-07-2${index}T00:00:00.000Z`,
      json_content: JSON.stringify({
        variables: [{
          id: `VAR-${index + 1}`,
          name: "折旧强度",
          category: "cost",
          variable_kind: "observed",
          definition: index ? "单位收入折旧" : "折旧相对收入强度",
          ontology_node_id: `task_local:VAR-${index + 1}`,
        }],
      }),
    }));
    const candidates = aggregateTaskLocalCandidates(extractTaskLocalCandidateOccurrences(rows));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "折旧强度",
      occurrence_count: 2,
      run_count: 2,
      cross_task_reused: true,
    });
    expect(candidates[0].definitions).toHaveLength(2);
  });
});
