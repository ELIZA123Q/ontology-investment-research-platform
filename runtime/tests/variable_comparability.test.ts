import { describe, expect, it } from "vitest";
import {
  VARIABLE_COMPARABILITY_KEY_VERSION,
  buildVariableComparabilityGroups,
  compareVariableObservations,
  extractVariableObservations,
  type VariableObservation,
} from "@/engine/variable_comparability";

function observation(overrides: Partial<VariableObservation> = {}): VariableObservation {
  return {
    observation_id: "run-a:SV-PRICE",
    run_id: "run-a",
    question: "DRAM 合约价是否上行",
    artifact_id: "a-1",
    artifact_version: 1,
    variable_id: "SV-PRICE",
    name: "DRAM 合约价",
    ontology_node_id: "SV-MARKET-PRICE",
    category: "market",
    variable_kind: "observed",
    anchors: ["contract price", "DRAM"],
    object_scope: ["全球非 HBM DRAM"],
    geography: "全球",
    metric_ref: "每 Gb 合约价",
    unit: "USD/GB",
    time_basis: "quarter_average",
    observation_period: "2026Q2",
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("cross-run variable comparability", () => {
  it("creates one stable versioned key across different observation periods", () => {
    const comparison = compareVariableObservations(observation(), observation({
      observation_id: "run-b:SV-PRICE-B",
      run_id: "run-b",
      artifact_id: "a-2",
      variable_id: "SV-PRICE-B",
      anchors: ["DRAM", "contract price"],
      observation_period: "2026Q3",
    }));
    expect(VARIABLE_COMPARABILITY_KEY_VERSION).toBe("variable-comparability-v1");
    expect(comparison.status).toBe("aligned");
    expect(comparison.comparable_key).toMatch(/^cmp:v1:[a-f0-9]{24}$/);
    expect(comparison.reasons[0]).toContain("可直接比较观测期差异");
  });

  it("blocks any critical mismatch and explains the exact dimension", () => {
    const comparison = compareVariableObservations(
      observation(),
      observation({ observation_id: "run-b:x", run_id: "run-b", unit: "CNY/GB" }),
    );
    expect(comparison.status).toBe("blocked");
    expect(comparison.comparable_key).toBeNull();
    expect(comparison.reasons).toContain("单位/币种不同（USD/GB / CNY/GB）");
  });

  it("does not guess when a required dimension is missing", () => {
    const comparison = compareVariableObservations(
      observation(),
      observation({ observation_id: "run-b:x", run_id: "run-b", geography: null }),
    );
    expect(comparison.status).toBe("insufficient");
    expect(comparison.reasons[0]).toContain("地区范围");
  });

  it("extracts variable fields, understands nested time scope, and excludes task-local candidates", () => {
    const rows = [{
      run_id: "run-a",
      question: "价格",
      artifact_id: "a-1",
      artifact_version: 1,
      created_at: "2026-07-01T00:00:00.000Z",
      json_content: JSON.stringify({
        research_scope: { dimensions: {
          core_object: "全球 DRAM",
          geography: "全球",
          metric: "合约价",
          unit: "USD/GB",
          time_scope: { time_basis: "quarter_average", as_of: "2026Q2" },
        } },
        variables: [
          { id: "SV-1", name: "价格", ontology_node_id: "SV-PRICE", category: "market", variable_kind: "observed", anchors: ["price"] },
          { id: "LOCAL", name: "渠道情绪", ontology_node_id: "task_local:LOCAL", category: "channel", variable_kind: "proxy", anchors: ["survey"] },
        ],
      }),
    }];
    expect(extractVariableObservations(rows)).toEqual([expect.objectContaining({
      variable_id: "SV-1",
      object_scope: "全球 DRAM",
      time_basis: "quarter_average",
      observation_period: "2026Q2",
    })]);
  });

  it("groups only cross-run occurrences of the same formal variable", () => {
    const groups = buildVariableComparabilityGroups([
      observation(),
      observation({ observation_id: "run-a:second", variable_id: "second" }),
      observation({ observation_id: "run-b:x", run_id: "run-b", observation_period: "2026Q3" }),
      observation({ observation_id: "run-c:y", run_id: "run-c", ontology_node_id: "SV-INVENTORY" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ ontology_node_id: "SV-MARKET-PRICE", aligned_count: 2, blocked_count: 0 });
  });
});
