import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { precheckStage03OntologyConstraints, precheckFindingsAsWeakLinks } from "@/engine/ontology_stage03_precheck";
import { recomputeStage03EvidenceQualityGate } from "@/engine/stage03_documents";
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

  it("treats cutoff boundaries in the same second as equivalent without relaxing fact times", () => {
    const base = {
      id: "EV-CUTOFF",
      kind: "fact_draft",
      statement: "已核验经营事实",
      directness: "direct",
      observed_at: "2025-06-30T23:59:59+08:00",
      valid_from: "2025-01-01T00:00:00+08:00",
      published_at: "2025-06-30T23:59:59+08:00",
      cutoff_at: "2025-06-30T23:59:59.999+08:00",
    };
    const equivalent = precheckStage03OntologyConstraints({
      evidence_drafts: [base],
      cutoff_at: "2025-06-30T23:59:59+08:00",
    });
    expect(equivalent.blocking_soft_count).toBe(0);

    const trulyLate = precheckStage03OntologyConstraints({
      evidence_drafts: [{ ...base, published_at: "2025-07-01T00:00:00+08:00" }],
      cutoff_at: "2025-06-30T23:59:59+08:00",
    });
    expect(trulyLate.findings.some((item) => item.rule_ref === "evidence_scope_time_alignment")).toBe(true);
  });

  it("is wired into the Stage03 approval recompute gate", () => {
    const groups = ["g1", "g2", "g3", "g1", "g2"];
    const sources = groups.map((group, index) => ({
      id: `SRC-${index + 1}`,
      publisher: group,
      source_group: group,
      url: `https://${group}.example/${index + 1}`,
      usability_status: "usable",
      retrieval_status: "captured",
      quote_verified: true,
    })) as any;
    const drafts = sources.map((source: any, index: number) => ({
      id: `EV-${index + 1}`,
      kind: index < 3 ? "fact_draft" : "counter",
      direction: index < 3 ? "support" : "weaken",
      statement: `可核验事实 ${index + 1}`,
      judgment_unit_ids: ["JU-1"],
      source_ids: [source.id],
      directness: "direct",
      scope_ref: index === 0 ? "SCOPE-WRONG" : "SCOPE-1",
      observed_at: "2026-06-01T00:00:00Z",
      valid_from: "2026-06-01T00:00:00Z",
      published_at: "2026-06-02T00:00:00Z",
      cutoff_at: "2026-07-01T00:00:00Z",
    }));
    const recomputed = recomputeStage03EvidenceQualityGate({
      evidence_drafts: drafts,
      quality_status: "high_quality_pass",
    }, {
      structure: {
        research_scope: { id: "SCOPE-1" },
        judgment_units: [{ id: "JU-1", judgment_type: "state" }],
        evidence_requirements: [{
          id: "ER-S",
          evidence_role: "support",
          minimum_independent_sources: 2,
          judgment_unit_ids: ["JU-1"],
        }, {
          id: "ER-C",
          evidence_role: "counter",
          minimum_independent_sources: 2,
          judgment_unit_ids: ["JU-1"],
        }],
      },
      sources,
      cutoffAt: "2026-07-01T00:00:00Z",
    });
    expect(recomputed.ontology_precheck.blocking_soft_count).toBe(1);
    expect(recomputed.evidence_quality_gate.ontology_precheck_blocking_soft_count).toBe(1);
    expect(recomputed.evidence_quality_gate.passed).toBe(false);
    expect(recomputed.quality_status).toBe("return_required");
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
          status: "applied",
          observed_contribution: true,
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
