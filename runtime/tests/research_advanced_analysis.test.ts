import { describe, expect, it } from "vitest";
import { buildResearchAdvancedAnalysis } from "@/engine/research_advanced_analysis";

describe("research advanced analysis", () => {
  it("turns graph queries into decision-relevant incremental findings", () => {
    const result = buildResearchAdvancedAnalysis({
      runId: "run-current",
      evidence: {
        evidence_quality_gate: { passed: true, total_evidence: 2, source_groups: 2 },
        evidence_drafts: [{ kind: "fact_draft" }, { kind: "gap" }],
      },
      judgment: {
        judgments: [
          { id: "J-1", strength: "J2", conclusion: "订单方向改善" },
          { id: "J-2", strength: "J0", conclusion: "资本开支暂不可判断", uncertainties: ["只有单一客户数据"] },
        ],
      },
      impactQueries: [
        { evidence: { id: "EV-1", label: "订单增长" }, impacted_judgments: [{ id: "J-1", label: "订单方向改善", strength: "J2" }], impacted_object_count: 4 },
        { evidence: { id: "EV-2", label: "闲置事实" }, impacted_judgments: [], impacted_object_count: 1 },
      ],
      variableUsages: [{
        semantic_ref: "order_visibility", label: "订单能见度", run_count: 2, occurrence_count: 2,
        occurrences: [
          { run_id: "run-current", question: "当前", name: "订单" },
          { run_id: "run-old", question: "历史", name: "订单" },
        ],
      }],
    });

    expect(result.quality).toMatchObject({ status: "limited", indeterminate_judgment_count: 1 });
    expect(result.findings.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "decision_limit", "single_point", "unused_evidence", "cross_run_reuse",
    ]));
  });

  it("groups decision limits by formal evidence requirement instead of repeating every J0 judgment", () => {
    const result = buildResearchAdvancedAnalysis({
      runId: "run-current",
      evidence: { evidence_quality_gate: { passed: true, total_evidence: 1 }, evidence_drafts: [{ kind: "gap" }] },
      judgment: { judgments: [
        { id: "J-1", strength: "J0", conclusion: "DRAM 暂不可判断" },
        { id: "J-2", strength: "J0", conclusion: "NAND 暂不可判断" },
      ] },
      impactQueries: [],
      variableUsages: [],
      requirementImpacts: [{
        id: "ER-1", label: "库存水位月度序列", role: "support", fulfillment: "unmet", blocking: true,
        affected_judgments: [
          { id: "J-1", label: "DRAM 暂不可判断", strength: "J0" },
          { id: "J-2", label: "NAND 暂不可判断", strength: "J0" },
        ],
      }],
    });
    const limits = result.findings.filter((item) => item.kind === "decision_limit");
    expect(limits).toHaveLength(1);
    expect(limits[0].detail).toContain("影响 2 个判断");
  });

  it("does not present repeated task-local candidates as formal cross-run reuse", () => {
    const result = buildResearchAdvancedAnalysis({
      runId: "run-current",
      evidence: {},
      judgment: {},
      impactQueries: [],
      variableUsages: [{
        semantic_ref: "task-local:key",
        label: "临时口径",
        source: "task_local",
        run_count: 2,
        occurrence_count: 2,
        occurrences: [
          { run_id: "run-current", question: "当前", name: "临时口径" },
          { run_id: "run-old", question: "历史", name: "临时口径" },
        ],
      }],
    });
    expect(result.reusable_variables).toHaveLength(0);
    expect(result.findings.some((item) => item.kind === "cross_run_reuse")).toBe(false);
  });
});
