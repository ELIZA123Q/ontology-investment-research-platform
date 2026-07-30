import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  compileEvidenceAcquisitionPlan,
  governedProducerForUrl,
  loadEvidenceSourceRoutes,
} from "@/engine/evidence_source_routes";

describe("machine-executable evidence source routes", () => {
  it("loads the method-layer registry and keeps mutable producers out of the ontology contract", () => {
    const registry = loadEvidenceSourceRoutes();
    expect(registry.version).toBe("1.1.0");
    expect(registry.routes.some((route) => route.evidence_profile_ids.includes("demand_orders"))).toBe(true);
    expect(registry.routes.flatMap((route) => route.producers).map((item) => item.domain)).toContain("wsts.org");
    expect(registry.routes.flatMap((route) => route.producers).map((item) => item.domain)).toContain("idc.com");
  });

  it("compiles a JU variable, EvidenceProfile and counter role into bounded queries and query cards", () => {
    const plan = compileEvidenceAcquisitionPlan({
      question: "判断 2026 年 HBM 需求是否持续",
      cutoffMs: Date.parse("2026-06-30T23:59:59Z"),
      targetUnitIds: ["JU-1"],
      structure: {
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
          ontology_node_ids: [],
        }],
      },
      requirements: [{
        id: "ER-COUNTER-1",
        requirement: "取得终端需求下修、订单取消或库存上升的反证",
        evidence_role: "counter",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "counter_direction",
      }],
    });
    expect(plan.generated_from.evidence_profile_ids).toContain("demand_orders");
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].route_ids).toContain("semiconductor_counter");
    expect(plan.tasks[0].query_card_refs.some((ref) => ref.includes("A08_反证"))).toBe(true);
    expect(plan.queries.length).toBeGreaterThan(0);
    expect(plan.queries.every((query) => query.includes("2026") && query.startsWith("site:"))).toBe(true);
    expect(plan.queries.join(" ")).not.toContain("2025");
  });

  it("accepts only producers declared by the compiled plan", () => {
    const plan = compileEvidenceAcquisitionPlan({
      question: "NAND 合约价和库存",
      requirements: [{
        id: "ER-1",
        requirement: "取得 NAND 合约价与库存证据",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
      structure: {
        judgment_units: [{ id: "JU-1", judgment_type: "cycle_phase", ontology_node_ids: [] }],
      },
    });
    expect(governedProducerForUrl("https://www.trendforce.com/presscenter/news", plan)?.name).toBe("TrendForce");
    expect(governedProducerForUrl("https://unrelated.example/news", plan)).toBeUndefined();
  });

  it("uses explicit profile refs before structural inference and exposes route_missing without generic fallback", () => {
    const explicit = compileEvidenceAcquisitionPlan({
      question: "市场预期是否已经计价",
      requirements: [{
        id: "ER-EXPECTATION",
        requirement: "取得事前一致预期、修正和估值基准",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
        evidence_profile_refs: ["market_expectations"],
        evidence_recipe_ref: "recipe_expectation_gap",
      }],
      structure: {
        judgment_units: [{ id: "JU-1", judgment_type: "expectation_gap", ontology_node_ids: [] }],
      },
    });
    expect(explicit.tasks[0]).toMatchObject({
      status: "ready",
      evidence_profile_ids: ["market_expectations"],
      evidence_recipe_ref: "recipe_expectation_gap",
    });
    expect(explicit.tasks[0].route_ids).toContain("semiconductor_market_expectations");

    const missing = compileEvidenceAcquisitionPlan({
      question: "未知画像",
      requirements: [{
        id: "ER-MISSING",
        requirement: "取得未知画像对应证据",
        evidence_role: "support",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
        evidence_profile_refs: ["profile_without_route"],
      }],
      structure: {
        judgment_units: [{ id: "JU-1", judgment_type: "state_measurement", ontology_node_ids: [] }],
      },
    });
    expect(missing.tasks[0]).toMatchObject({ status: "route_missing", route_ids: [], queries: [] });
    expect(missing.gap_details[0]).toMatchObject({
      requirement_id: "ER-MISSING",
      code: "route_missing",
      evidence_profile_ids: ["profile_without_route"],
    });
    expect(missing.queries).toEqual([]);
  });
});
