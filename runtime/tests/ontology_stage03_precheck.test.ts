import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { precheckStage03OntologyConstraints, precheckFindingsAsWeakLinks } from "@/engine/ontology_stage03_precheck";
import { buildEvidenceProfileGapHints, profileHintsAsGapPriorities } from "@/engine/evidence_profile_gaps";
import { buildOntologyContributionSummary } from "@/engine/ontology_contribution_summary";

describe("ontology_stage03_precheck", () => {
  it("flags proxy facts missing disclosure as blocking_soft", () => {
    const summary = precheckStage03OntologyConstraints({
      evidence_drafts: [{
        id: "EV-1",
        kind: "fact_draft",
        statement: "订单领先指标显示需求改善",
        directness: "proxy",
      }],
      cutoff_at: "2026-07-18T00:00:00Z",
    });
    expect(summary.blocking_soft_count).toBeGreaterThan(0);
    expect(summary.findings.some((item) => item.rule_ref === "semiconductor_proxy_disclosure")).toBe(true);
    expect(precheckFindingsAsWeakLinks(summary)[0]).toMatch(/判断确认时挡门/);
  });

  it("flags capacity/yield claims missing six-dimension measurement", () => {
    const summary = precheckStage03OntologyConstraints({
      evidence_drafts: [{
        id: "EV-2",
        kind: "fact_draft",
        statement: "某厂产能利用率提升",
        directness: "direct",
      }],
    });
    expect(summary.findings.some((item) => item.rule_ref === "semiconductor_capacity_yield_scope_alignment")).toBe(true);
  });

  it("does not rewrite drafts and ignores gaps", () => {
    const drafts = [{ id: "GAP-1", kind: "gap", statement: "缺少库存序列" }];
    const summary = precheckStage03OntologyConstraints({ evidence_drafts: drafts });
    expect(summary.findings).toHaveLength(0);
    expect(drafts[0].kind).toBe("gap");
  });
});

describe("evidence_profile_gaps", () => {
  it("projects EvidenceProfile minimum requirements for formal StateVariable bindings", () => {
    const hints = buildEvidenceProfileGapHints({
      variables: [
        { id: "V-1", name: "终端需求强度", ontology_node_id: "end_market_demand_strength" },
        { id: "V-2", name: "本轮临时口径", ontology_node_id: "task_local:adhoc_metric" },
      ],
      limit: 3,
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].source).toBe("evidence_profile");
    expect(hints[0].profile_id).toBeTruthy();
    expect(hints[0].minimum_requirements.length + hints[0].supporting_evidence.length).toBeGreaterThan(0);
    expect(hints.every((item) => !item.matched_ontology_node_ids.some((id) => id.startsWith("task_local:")))).toBe(true);

    const priorities = profileHintsAsGapPriorities(hints);
    expect(priorities[0].evidence_id).toMatch(/^PROFILE:/);
    expect(priorities[0].reason).toContain(hints[0].profile_id);
  });
});

describe("ontology_contribution_summary", () => {
  it("builds researcher-facing headline without internal IDs", () => {
    const summary = buildOntologyContributionSummary({
      researchValue: {
        effects: [{
          id: "constraint:rule:RE-SYS-1",
          kind: "constraint",
          title: "证据门槛：未通过",
          explanation: "请求 J2 超过证据上限",
          result: "限制：阻止判断越过当前证据与语义边界",
          object_refs: ["RE-SYS-1", "JU-1"],
          ontology_refs: ["judgment_evidence_threshold"],
        }],
        counts: { completion: 0, constraint: 1, connection: 0 },
        relevant_node_ids: ["judgment_evidence_threshold"],
      },
      judgments: [{ strength: "J0", not_judgeable_reason: "judgment_evidence_threshold 未通过" }],
      limit: 3,
    });
    expect(summary.headline).toMatch(/暂不判断|约束/);
    expect(summary.headline).not.toMatch(/JU-|RE-SYS/);
    expect(summary.lines[0]?.title).not.toMatch(/RE-SYS/);
  });
});
