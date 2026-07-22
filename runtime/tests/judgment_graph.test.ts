import { describe, expect, it } from "vitest";
import { buildJudgmentReviewGraph } from "../app/lib/judgment-graph";

const baseStage04 = {
  signals: [{
    id: "S-1",
    statement: "库存下降支持趋势改善",
    role: "support",
    evidence_draft_ids: ["EV-1"],
    judgment_unit_ids: ["JU-1"],
    target_hypothesis_ids: ["H-1"],
  }],
  hypotheses: [{
    id: "H-1",
    statement: "库存去化代表需求改善",
    signal_ids: ["S-1"],
    falsification_conditions: ["库存重新上升"],
    time_horizon: "未来一个季度",
  }],
  competing_explanations: [{
    id: "CE-1",
    statement: "季节性备货导致库存下降",
    signal_ids: ["S-1"],
    discriminating_evidence: ["跨周期对照"],
    status: "active",
    elimination_rationale: "",
    judgment_unit_ids: ["JU-1"],
  }],
  rule_evaluations: [{
    id: "RE-1",
    rule_ref: "evidence_scope_time_alignment",
    input_refs: ["EV-1"],
    condition_results: [{
      condition_id: "scope_match",
      expression: "evidence.scope == judgment.scope",
      input_refs: ["EV-1"],
      outcome: "pass",
      rationale: "证据与判断范围一致",
    }],
    result: "pass",
    deterministic_result: null,
  }],
  judgments: [{
    id: "J-1",
    judgment_unit_id: "JU-1",
    title: "库存趋势",
    conclusion: "库存去化方向成立",
    rationale: "两条独立序列一致",
    strength: "J2",
    decision_status: "supported",
    conflict_status: "none",
    not_judgeable_reason: null,
    hypothesis_ids: ["H-1"],
    rule_evaluation_ids: ["RE-1"],
    invalidation_conditions: ["库存回升"],
    tracking_signals: ["库存"],
    uncertainties: ["供给"],
  }],
  reasoning_traces: [{
    id: "RT-1",
    judgment_id: "J-1",
    node_ids: ["EV-1", "S-1", "H-1", "RE-1", "J-1"],
    created_at: "2026-07-17T12:00:00+08:00",
  }],
};

describe("judgment-graph", () => {
  it("包含规则评估与推理留痕节点，并连接主链", () => {
    const graph = buildJudgmentReviewGraph({
      stage04: baseStage04,
      evidenceDrafts: [{ id: "EV-1", statement: "库存连续两周下降", kind: "support", direction: "support" }],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["EV-1", "S-1", "H-1", "RE-1", "J-1", "RT-1", "CE-1"]),
    );
    expect(graph.nodes.find((node) => node.id === "RE-1")?.meta).toBe("规则评估 · pass");
    expect(graph.nodes.find((node) => node.id === "RT-1")?.meta).toBe("推理留痕");
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "RE-1", target: "J-1", label: "规则评估" }),
      expect.objectContaining({ source: "J-1", target: "RT-1", label: "留痕" }),
      expect.objectContaining({ source: "EV-1", target: "S-1" }),
      expect.objectContaining({ source: "S-1", target: "H-1" }),
    ]));
    const traceDetails = graph.nodes.find((node) => node.id === "RT-1")?.details as Record<string, unknown>;
    expect(traceDetails["追溯顺序"]).toEqual([
      "EV-1: 库存连续两周下降",
      "S-1: 库存下降支持趋势改善",
      "H-1: 库存去化代表需求改善",
      "RE-1: evidence_scope_time_alignment",
      "J-1: 库存去化方向成立",
    ]);
  });

  it("阻断信号与 blocked 判断状态显式呈现", () => {
    const graph = buildJudgmentReviewGraph({
      stage04: {
        ...baseStage04,
        signals: [{
          id: "S-BLOCK",
          statement: "决定性反证阻断方向判断",
          role: "block",
          evidence_draft_ids: ["EV-2"],
          judgment_unit_ids: ["JU-1"],
          target_hypothesis_ids: ["H-1"],
        }],
        judgments: [{
          ...baseStage04.judgments[0],
          id: "J-BLOCK",
          conclusion: "当前不可判断",
          strength: "J0",
          decision_status: "blocked",
          conflict_status: "decisive",
          not_judgeable_reason: "决定性反证成立",
          hypothesis_ids: ["H-1"],
        }],
        reasoning_traces: [{
          id: "RT-BLOCK",
          judgment_id: "J-BLOCK",
          node_ids: ["EV-2", "S-BLOCK", "H-1", "RE-1", "J-BLOCK"],
          created_at: "2026-07-17T12:00:00+08:00",
        }],
      },
      evidenceDrafts: [
        { id: "EV-1", statement: "库存连续两周下降", kind: "support", direction: "support" },
        { id: "EV-2", statement: "终端需求明显走弱", kind: "counter", direction: "weaken" },
      ],
    });
    const blockSignal = graph.nodes.find((node) => node.id === "S-BLOCK");
    const blockedJudgment = graph.nodes.find((node) => node.id === "J-BLOCK");
    expect(blockSignal?.meta).toBe("阻断信号");
    expect(blockSignal?.tone).toBe("danger");
    expect(blockedJudgment?.meta).toBe("判断 · J0 · blocked");
    expect(blockedJudgment?.tone).toBe("danger");
    expect(blockedJudgment?.details).toMatchObject({
      判断状态: "blocked",
      不可判断原因: "决定性反证成立",
    });
  });

  it("无信号/假设/规则评估时返回空态原因", () => {
    const graph = buildJudgmentReviewGraph({
      stage04: {
        signals: [],
        hypotheses: [],
        competing_explanations: [],
        rule_evaluations: [],
        judgments: [{
          id: "J-ONLY",
          judgment_unit_id: "JU-1",
          title: "仅判断",
          conclusion: "占位判断",
          strength: "J0",
          decision_status: "draft",
          hypothesis_ids: [],
          rule_evaluation_ids: [],
        }],
        reasoning_traces: [],
      },
      evidenceDrafts: [],
    });
    expect(graph.emptyReason).toBe("阶段 04 已有判断，但尚未形成信号、假设或规则评估链。");
  });
});
