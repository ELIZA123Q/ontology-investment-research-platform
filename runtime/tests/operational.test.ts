import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-v13-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let instanceGraph: typeof import("@/engine/instance_graph");
let actionExecutor: typeof import("@/engine/action_executor");
let ontologyTools: typeof import("@/engine/ontology_tools");
let publish: typeof import("@/adapters/publish_package");

beforeAll(async () => {
  db = await import("@/adapters/db");
  instanceGraph = await import("@/engine/instance_graph");
  actionExecutor = await import("@/engine/action_executor");
  ontologyTools = await import("@/engine/ontology_tools");
  publish = await import("@/adapters/publish_package");
});

describe("v1.3 operational spine", () => {
  it("does not silently treat draft projection as formal authority", () => {
    const run = db.createRun("双轨测试", "semiconductor");
    db.createArtifact(run.id, "stage_02", {
      status: "needs_review",
      json_content: JSON.stringify({
        method_selections: [{ method_id: "m", method_version: "1", purpose: "p", selection_reason: "r", rejected_candidate_ids: [] }],
        judgment_units: [{ id: "JU-X", title: "t", question: "q", ontology_node_ids: [], evidence_requirements: [] }],
        variables: [],
        paths: [],
        counter_evidence_directions: [],
        competing_explanations: [],
        document_markdown: "x".repeat(50),
      }),
    });
    const loaded = instanceGraph.loadGraphForRun(run.id);
    expect(loaded.authority).toBe("empty");
    const provisional = instanceGraph.buildProvisionalProjection(run.id);
    expect(provisional.authority).toBe("workbench_provisional");
    expect(provisional.objects.some((o) => o.id === "JU-X")).toBe(true);
  });

  it("runs RegisterSource → ExtractClaim → AssessEvidenceForUse spine", () => {
    let graph = instanceGraph.emptyGraph();
    const source = actionExecutor.executeAction(
      "RegisterSource",
      { title: "测试来源", locator: "https://example.com/a", sourceTier: "disclosure" },
      graph,
    );
    expect(source.status).toBe("executed");
    graph = source.graph;
    const claim = actionExecutor.executeAction(
      "ExtractClaim",
      { sourceRef: source.written_object_ids[0], statement: "价格上行", contentRange: "para-1" },
      graph,
    );
    expect(claim.status).toBe("executed");
    graph = claim.graph;
    const assess = actionExecutor.executeAction(
      "AssessEvidenceForUse",
      { evidenceRefs: claim.written_object_ids, assessmentScope: "test" },
      graph,
    );
    expect(assess.status).toBe("executed");
    expect(assess.graph.objects.some((o) => o.type === "EvidenceAssessment")).toBe(true);
  });

  it("forms hypothesis and judgment then records reasoning trace", () => {
    let graph = instanceGraph.emptyGraph();
    graph.objects.push({ id: "SV-1", type: "StateVariable", properties: { name: "price" } });
    const hyp = actionExecutor.executeAction(
      "FormHypothesis",
      { statement: "价格将继续上行", variableRef: "SV-1", falsificationConditions: "合约价回落", direction: "up" },
      graph,
    );
    expect(hyp.status).toBe("executed");
    graph = hyp.graph;
    const judgment = actionExecutor.executeAction(
      "FormJudgment",
      { statement: "有条件看多", hypothesisRefs: hyp.written_object_ids, judgmentLevel: "J2" },
      graph,
    );
    expect(judgment.status).toBe("executed");
    graph = judgment.graph;
    const trace = actionExecutor.executeAction(
      "RecordReasoningTrace",
      { judgmentRef: judgment.written_object_ids[0], steps: ["h", "j"], status: "recorded" },
      graph,
    );
    expect(trace.status).toBe("executed");
    expect(trace.graph.objects.some((o) => o.type === "ReasoningTrace")).toBe(true);
  });

  it("exports package and invokes validate_run bridge", () => {
    const run = db.createRun("发布桥测试", "semiconductor", "instances/01_正式样例/01_存储周期");
    const exported = publish.exportRunPackage(run.id);
    expect(exported.exportRel).toContain("exports");
    const result = publish.publishAndValidate(run.id);
    expect(result.export_rel).toContain(run.id);
    expect(result.validation_summary.publish_status).toMatch(/validate_/);
    const updated = db.getRun(run.id)!;
    expect(updated.manifest_json).toContain("validate_");
  });

  it("queries package-bound object set", () => {
    const run = db.createRun("对象集测试", "semiconductor", "instances/01_正式样例/01_存储周期");
    const set = ontologyTools.runOntologyTool(run.id, "query_object_set", { type: "JudgmentUnit", limit: 5 });
    expect((set as any).objects.length).toBeGreaterThan(0);
  });
});
