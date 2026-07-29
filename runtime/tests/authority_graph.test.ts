import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAuthorityGraphCandidate,
  emptyGraph,
  materializeStageIntoGraph,
  type AuthorityStageInput,
} from "@/engine/instance_graph";
import { validateRuntimeGraph } from "@/engine/graph_contract";

function stage(
  kind: AuthorityStageInput["kind"],
  version: number,
  data: Record<string, unknown>,
): AuthorityStageInput {
  return {
    kind,
    artifact_id: `ART-${kind}-${version}`,
    artifact_version: version,
    data,
  };
}

const structure = {
  research_scope: {
    id: "SCOPE-1",
    label: "测试范围",
    dimensions: { domain: "semiconductor" },
  },
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

describe("authority graph rebuild contract", () => {
  it("replays a contiguous stage sequence and removes stale downstream projections", () => {
    let old = emptyGraph();
    old = materializeStageIntoGraph(old, "stage_02", structure);
    old = materializeStageIntoGraph(old, "stage_04", {
      judgments: [{
        id: "J-STALE",
        judgment_unit_id: "JU-1",
        conclusion: "旧判断",
      }],
    });
    old.objects.push({
      id: "SRC-ACTION",
      type: "SourceDocument",
      properties: { title: "Action 写入来源" },
      projection: { section: "sources", origin: "action" },
    });
    old.objects.push({
      id: "LEGACY-UNTAGGED",
      type: "SourceDocument",
      properties: { title: "旧式无归属节点" },
    });

    const candidate = buildAuthorityGraphCandidate([
      stage("stage_02", 2, structure),
      stage("stage_03", 3, {}),
    ], old);

    expect(candidate.objects.some((object) => object.id === "J-STALE")).toBe(false);
    expect(candidate.objects.some((object) => object.id === "LEGACY-UNTAGGED")).toBe(false);
    expect(candidate.objects.find((object) => object.id === "SRC-ACTION")?.projection?.origin).toBe("action");
    expect(candidate.objects.find((object) => object.id === "JU-1")?.projection).toMatchObject({
      stage: "stage_02",
      origin: "stage_projection",
    });
    expect(Object.keys(candidate.projection_fingerprints || {})).toEqual(["stage_02", "stage_03"]);
  });

  it("creates deterministic artifact-bound fingerprints and rejects stage gaps", () => {
    const first = buildAuthorityGraphCandidate([stage("stage_02", 1, structure)]);
    const same = buildAuthorityGraphCandidate([stage("stage_02", 1, structure)]);
    const revised = buildAuthorityGraphCandidate([stage("stage_02", 2, structure)]);
    expect(first.projection_fingerprints?.stage_02).toBe(same.projection_fingerprints?.stage_02);
    expect(first.projection_fingerprints?.stage_02).not.toBe(revised.projection_fingerprints?.stage_02);
    expect(() => buildAuthorityGraphCandidate([
      stage("stage_03", 1, {}),
    ])).toThrow(/必须从 stage_02 连续重放/);
  });

  it("produces a graph that is valid against ontology endpoint and closure constraints", () => {
    const candidate = buildAuthorityGraphCandidate([
      stage("stage_02", 1, structure),
    ]);
    expect(() => validateRuntimeGraph(candidate)).not.toThrow();
  });
});
