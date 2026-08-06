import { describe, expect, it } from "vitest";
import {
  aggregateTaskLocalCandidates,
  candidateSimilarities,
  extractTaskLocalCandidateOccurrences,
  ontologyCandidateKey,
} from "@/05_governance/ontology_changes/candidates";

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

  it("only groups conservative synonyms inside the same domain, category and variable kind", () => {
    const base = {
      occurrence_count: 1,
      run_count: 1,
      cross_task_reused: false,
      run_ids: ["run-1"],
      questions: ["问题"],
      variable_ids: ["VAR"],
      first_observed_at: "2026-08-01T00:00:00.000Z",
      last_observed_at: "2026-08-01T00:00:00.000Z",
    };
    const source = {
      ...base,
      candidate_key: "source",
      name: "单位收入折旧强度",
      category: "cost",
      variable_kind: "observed",
      domains: ["semiconductor"],
      definitions: ["单位收入对应的折旧费用强度"],
      anchors: ["Company"],
    };
    const synonym = {
      ...source,
      candidate_key: "synonym",
      name: "单位收入折旧强度指标",
      definitions: ["单位收入对应的折旧费用强度"],
    };
    const otherDomain = { ...synonym, candidate_key: "other-domain", domains: ["healthcare"] };
    const otherKind = { ...synonym, candidate_key: "other-kind", variable_kind: "inferred" };
    const similarities = candidateSimilarities(source, [source, synonym, otherDomain, otherKind]);
    expect(similarities).toHaveLength(1);
    expect(similarities[0]).toMatchObject({ candidate_key: "synonym", confidence: "high" });
    expect(similarities[0].reason).toMatch(/名称.*定义.*锚点/);
  });
});
