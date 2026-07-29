import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-semantic-reads-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let graph: typeof import("@/engine/instance_graph");
let reads: typeof import("@/engine/semantic_reads");

const structure = {
  research_scope: { id: "SCOPE-1", label: "测试范围", dimensions: { domain: "semiconductor" } },
  judgment_units: [{
    id: "JU-1",
    title: "库存状态",
    question: "库存是否下降",
    judgment_type: "state_measurement",
    scope_ref: "SCOPE-1",
    ontology_node_ids: [],
    evidence_requirements: [],
  }],
};

beforeAll(async () => {
  db = await import("@/adapters/db");
  graph = await import("@/engine/instance_graph");
  reads = await import("@/engine/semantic_reads");
});

describe("approved semantic snapshot authority", () => {
  it("marks old runs without a fingerprinted authority graph as an explicit legacy fallback", () => {
    const run = db.createRun("旧运行兼容读取", "semiconductor");
    db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify(structure),
      approved_at: new Date().toISOString(),
    });
    expect(reads.loadApprovedSemanticSnapshot(run.id, "stage_02")).toMatchObject({
      authority: "legacy_artifact_fallback",
      graph_artifact_source: null,
    });
  });

  it("verifies an approved snapshot against the authority graph and rejects later drift", () => {
    const run = db.createRun("正式图指纹读取", "semiconductor");
    const artifact = db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify(structure),
      approved_at: new Date().toISOString(),
    });
    const candidate = graph.buildAuthorityGraphCandidate([{
      kind: "stage_02",
      artifact_id: artifact.id,
      artifact_version: artifact.version,
      data: structure,
    }]);
    db.saveInstanceGraph(run.id, {
      authority_contract: "ontology_authority_graph_v1",
      business_instance_graph: candidate,
    });
    expect(reads.loadApprovedSemanticSnapshot(run.id, "stage_02")).toMatchObject({
      authority: "formal_graph_verified",
      artifact: { id: artifact.id },
    });

    db.updateArtifact(artifact.id, {
      json_content: JSON.stringify({
        ...structure,
        research_scope: { ...structure.research_scope, label: "绕过图谱的修改" },
      }),
    });
    expect(() => reads.loadApprovedSemanticSnapshot(run.id, "stage_02")).toThrow(
      /与正式实例图指纹不一致/,
    );
  });

  it("rejects a modern authority graph that lost its declared stage fingerprint", () => {
    const run = db.createRun("正式图缺失指纹", "semiconductor");
    db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify(structure),
      approved_at: new Date().toISOString(),
    });
    db.saveInstanceGraph(run.id, {
      authority_contract: "ontology_authority_graph_v1",
      business_instance_graph: graph.emptyGraph(),
    });
    expect(() => reads.loadApprovedSemanticSnapshot(run.id, "stage_02")).toThrow(
      /缺少 stage_02 投影指纹/,
    );
  });
});
