import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyDeterministicRuleEvaluations, REQUIRED_RULES } from "@/engine/semantic_execution";

const cutoff = "2026-07-18T08:00:00Z";

function source() {
  return {
    id: "SRC-1",
    url: "https://example.com/source",
    final_url: "https://example.com/source",
    publisher: "Example",
    source_tier: "S2",
    source_group: "example-primary",
    usability_status: "usable",
    retrieval_status: "captured",
    quote_verified: true,
    content_hash: "a".repeat(64),
    published_at: "2026-07-18T00:00:00Z",
  } as any;
}

function fact(overrides: Record<string, unknown> = {}) {
  return {
    id: "EV-1",
    statement: "公司披露本期经营数据",
    source_ids: ["SRC-1"],
    scope_ref: "SCOPE-1",
    observed_at: "2026-07-17T00:00:00Z",
    valid_from: "2026-07-17T00:00:00Z",
    valid_to: null,
    published_at: "2026-07-18T00:00:00Z",
    cutoff_at: cutoff,
    directness: "direct",
    limitations: [],
    ...overrides,
  } as any;
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    signals: [{ id: "S-1", evidence_draft_ids: ["EV-1"], target_hypothesis_ids: ["H-1"] }],
    hypotheses: [{ id: "H-1", signal_ids: ["S-1"] }],
    competing_explanations: [],
    rule_evaluations: [],
    judgments: [{
      id: "J-1",
      judgment_unit_id: "JU-1",
      title: "经营状态判断",
      conclusion: "现有事实形成观察",
      strength: "J1",
      decision_status: "supported",
      conflict_status: "none",
      scope_ref: "SCOPE-1",
      cutoff_at: cutoff,
      supporting_evidence_draft_ids: ["EV-1"],
      counter_evidence_draft_ids: [],
      hypothesis_ids: ["H-1"],
      rule_evaluation_ids: [],
      ...overrides,
    }],
    reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["J-1"] }],
  };
}

function apply(data: any, evidence: any[]) {
  return applyDeterministicRuleEvaluations(data, evidence, [source()], { judgment_units: [{ id: "JU-1" }] });
}

describe("formal ontology deterministic execution", () => {
  it("executes every runtime semantic rule for each judgment", () => {
    const result = apply(decision(), [fact()]);
    expect(REQUIRED_RULES).toHaveLength(9);
    expect(result.rule_evaluations.map((item: any) => item.rule_ref).sort()).toEqual([...REQUIRED_RULES].sort());
    expect(result.rule_evaluations.every((item: any) => item.deterministic_result.engine_version === "runtime-semantic-rules-3.0.0")).toBe(true);
  });

  it("demotes judgments when observations are after cutoff or validity is inverted", () => {
    const result = apply(decision(), [fact({
      observed_at: "2026-07-19T00:00:00Z",
      valid_to: "2026-07-16T00:00:00Z",
    })]);
    expect(result.judgments[0]).toMatchObject({
      strength: "J0",
      decision_status: "indeterminate",
      supporting_evidence_draft_ids: [],
    });
    expect(String(result.judgments[0].not_judgeable_reason)).toMatch(/state_time_consistency|evidence_scope_time_alignment/);
  });

  it("demotes proxy judgments until lag, scope and non-substitution are disclosed", () => {
    const blocked = apply(decision(), [fact({ directness: "proxy" })]);
    expect(blocked.judgments[0].strength).toBe("J0");
    expect(() => apply(decision(), [fact({
      directness: "proxy",
      proxy_disclosure: {
        lag: "订单通常领先收入约两个季度",
        scope: "仅适用于该产品和客户范围",
        non_substitution: "不能替代收入确认和客户验收证据",
      },
    })])).not.toThrow();
  });

  it("demotes a low-stage commercialization fact used for a higher-stage claim", () => {
    const scope = { product_spec_ref: "HBM3E", customer_ref: "客户A", facility_ref: "Fab-1" };
    const judgment = decision({
      title: "量产阶段判断",
      conclusion: "HBM3E 已进入量产",
      claimed_commercialization_stage: "mass_production",
      qualification_claim_scope: scope,
    });
    const demoted = apply(judgment, [fact({
      statement: "客户A收到HBM3E样品",
      commercialization_stage: "sample",
      qualification_scope: scope,
    })]);
    expect(demoted.judgments[0].strength).toBe("J0");
    expect(demoted.judgments[0].claimed_commercialization_stage).toBeNull();
    expect(() => apply(judgment, [fact({
      statement: "客户A确认HBM3E进入量产",
      commercialization_stage: "mass_production",
      qualification_scope: scope,
    })])).not.toThrow();
  });

  it("demotes capacity or yield evidence whose six-dimensional scope differs from the claim", () => {
    const claimScope = {
      metric_kind: "yield",
      facility_ref: "Fab-1",
      wafer_size: "300mm",
      process_or_product_ref: "HBM3E",
      batch_stage: "mass_production",
      unit: "%",
      business_time_basis: "2026Q2 average",
    };
    const judgment = decision({
      title: "良率判断",
      conclusion: "Fab-1 的 HBM3E 量产良率改善",
      semiconductor_claim_scope: claimScope,
    });
    const demoted = apply(judgment, [fact({
      statement: "Fab-2 样品良率为80%",
      semiconductor_measurement: { ...claimScope, facility_ref: "Fab-2", batch_stage: "sample" },
    })]);
    expect(demoted.judgments[0].strength).toBe("J0");
    expect(demoted.judgments[0].semiconductor_claim_scope).toBeNull();
    expect(() => apply(judgment, [fact({
      statement: "Fab-1 的 HBM3E 量产良率改善",
      semiconductor_measurement: claimScope,
    })])).not.toThrow();
  });

  it("does not treat capacity-expansion narrative as a capacity metric claim", () => {
    const result = apply(decision({
      title: "高折旧的AI产能扩张归因",
      conclusion: "尚不能确认高折旧由AI产能扩张单独解释",
    }), [fact()]);
    expect(result.judgments[0].strength).toBe("J1");
    const capacityRule = result.rule_evaluations.find((item: any) => item.rule_ref === "semiconductor_capacity_yield_scope_alignment");
    expect(capacityRule.result).toBe("pass");
  });
});
