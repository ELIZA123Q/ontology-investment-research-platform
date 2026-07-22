import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-candidates-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let repository: typeof import("@/adapters/ontology_candidates");

beforeAll(async () => {
  db = await import("@/adapters/db");
  repository = await import("@/adapters/ontology_candidates");
});

describe("ontology candidate governance repository", () => {
  it("aggregates current stage02 candidates and keeps append-only expert decisions", () => {
    const candidateName = `跨任务折旧口径-${crypto.randomUUID()}`;
    for (const suffix of ["A", "B"]) {
      const run = db.createRun(`候选治理研究-${suffix}-${crypto.randomUUID()}`, "semiconductor");
      db.createArtifact(run.id, "stage_02", {
        status: "approved",
        json_content: JSON.stringify({
          variables: [{
            id: `VAR-${suffix}`,
            name: candidateName,
            category: "cost",
            variable_kind: "observed",
            definition: "稳定的单位收入折旧口径",
            ontology_node_id: `task_local:VAR-${suffix}`,
          }],
        }),
      });
    }
    const candidate = repository.listOntologyCandidates().find((item) => item.name === candidateName)!;
    expect(candidate).toMatchObject({ run_count: 2, occurrence_count: 2, cross_task_reused: true });
    const confirmed = repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "expert_confirmed",
      expertName: "测试专家",
      decisionNote: "跨任务重复且定义稳定，确认存在正式本体缺口",
    });
    expect(confirmed.review.status).toBe("expert_confirmed");
    expect(() => repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "批准进入正式本体变更流程",
      targetOntologyNodeId: "task_local:still-local",
    })).toThrow(/不能继续使用 task_local/);
    const promoted = repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "批准进入正式本体变更流程，仍需 YAML 评审发布",
      targetOntologyNodeId: "depreciation_intensity",
    });
    expect(promoted.review).toMatchObject({
      status: "promoted",
      target_ontology_node_id: "depreciation_intensity",
    });
    expect(promoted.review_events).toHaveLength(2);
    expect(promoted.review_events.map((event) => event.next_status)).toEqual(["promoted", "expert_confirmed"]);
  });
});
