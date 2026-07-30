import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  bindEvidenceRequirementsToOntology,
} from "@/engine/evidence_requirement_bindings";
import {
  emptyGraph,
  materializeStageIntoGraph,
} from "@/engine/instance_graph";

describe("EvidenceRequirement ontology bindings", () => {
  it("materializes explicit EvidenceProfile, EvidenceRecipe and derivation refs", () => {
    const result = bindEvidenceRequirementsToOntology({
      variables: [{
        id: "VAR-1",
        ontology_node_id: "end_market_demand_strength",
      }],
      paths: [{
        id: "PATH-1",
        variable_ids: ["VAR-1"],
        judgment_unit_ids: ["JU-1"],
      }],
      judgment_units: [{
        id: "JU-1",
        judgment_type: "cycle_phase",
        evidence_requirements: ["需求与订单连续数据"],
      }],
      evidence_requirements: [{
        id: "ER-1",
        requirement: "取得需求与订单连续数据并核对库存变化",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
    });

    expect(result.issues).toEqual([]);
    expect(result.requirements[0]).toMatchObject({
      evidence_profile_refs: ["demand_orders"],
      evidence_recipe_ref: "recipe_cycle_phase",
      derivation_refs: {
        judgment_unit_ref: "JU-1",
        state_variable_refs: ["end_market_demand_strength"],
        path_refs: ["PATH-1"],
      },
      no_profile_reason: null,
    });
  });

  it("blocks a formal StateVariable without a profile but permits task_local with a reason", () => {
    const formal = bindEvidenceRequirementsToOntology({
      variables: [{ id: "VAR-1", ontology_node_id: "unregistered_formal_state" }],
      paths: [{ id: "PATH-1", variable_ids: ["VAR-1"], judgment_unit_ids: ["JU-1"] }],
      judgment_units: [{
        id: "JU-1",
        judgment_type: "trend_direction",
        evidence_requirements: ["正式变量趋势数据"],
      }],
    });
    expect(formal.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "evidence_profile_binding_missing", blocking: true }),
    ]));
    expect(formal.requirements[0].evidence_recipe_ref).toBe("recipe_trend_direction");

    const local = bindEvidenceRequirementsToOntology({
      variables: [{ id: "VAR-1", ontology_node_id: "task_local:VAR-1" }],
      paths: [{ id: "PATH-1", variable_ids: ["VAR-1"], judgment_unit_ids: ["JU-1"] }],
      judgment_units: [{
        id: "JU-1",
        judgment_type: "state_measurement",
        evidence_requirements: ["任务局部变量数据"],
      }],
    });
    expect(local.issues).toEqual([]);
    expect(local.requirements[0]).toMatchObject({
      evidence_profile_refs: [],
      evidence_recipe_ref: "recipe_state_measurement",
      no_profile_reason: "task_local_or_unbound_state_variable",
    });
  });

  it("materializes runtime relation edges when the governed parameter nodes are in the merged view", () => {
    const graph = emptyGraph();
    graph.objects.push(
      { id: "demand_orders", type: "EvidenceProfile", properties: { id: "demand_orders" } },
      { id: "recipe_cycle_phase", type: "EvidenceRecipe", properties: { id: "recipe_cycle_phase" } },
    );
    const projected = materializeStageIntoGraph(graph, "stage_02", {
      judgment_units: [{
        id: "JU-1",
        question: "需求是否持续",
        judgment_type: "cycle_phase",
        evidence_requirements: ["ER-1"],
      }],
      evidence_requirements: [{
        id: "ER-1",
        requirement: "取得需求和订单的连续可比证据",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        evidence_profile_refs: ["demand_orders"],
        evidence_recipe_ref: "recipe_cycle_phase",
      }],
    });
    expect(projected.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "requirementUsesEvidenceProfile",
        sourceId: "ER-1",
        targetId: "demand_orders",
      }),
      expect.objectContaining({
        type: "requirementGovernedByRecipe",
        sourceId: "ER-1",
        targetId: "recipe_cycle_phase",
      }),
    ]));
  });
});
