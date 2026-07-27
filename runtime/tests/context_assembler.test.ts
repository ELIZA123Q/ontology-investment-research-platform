import { describe, expect, it } from "vitest";
import {
  buildSemanticRoute,
  CONTEXT_SLOT_BUDGETS,
  loadRoutedKnowledge,
} from "@/engine/context_assembler";
import { compactStage03ForUpstream } from "@/engine/workflow_support";
import { ensureEvidenceCompressionFields, collectNumericGroundingWarnings } from "@/engine/stage03_documents";

describe("context_assembler", () => {
  it("projects semantic route from stage02 structure", () => {
    const route = buildSemanticRoute([
      {
        kind: "stage_02",
        json: {
          judgment_units: [
            { id: "JU-1", judgment_type: "cycle_phase", ontology_node_ids: ["SV-inventory"] },
          ],
          variables: [{ id: "V-1", ontology_node_id: "task_local:V-1" }],
          competing_explanations: [{ explanation_id: "CE-1", statement: "补库存" }],
          method_applications: [
            { capability_type: "evidence", method_id: "kb03:A03" },
            { capability_type: "adjudication", method_id: "kb04:A03" },
          ],
        },
      },
    ]);
    expect(route.judgment_unit_ids).toEqual(["JU-1"]);
    expect(route.judgment_types).toContain("cycle_phase");
    expect(route.ontology_node_ids).toEqual(expect.arrayContaining(["SV-inventory", "task_local:V-1"]));
    expect(route.competing_explanation_ids).toEqual(["CE-1"]);
    expect(CONTEXT_SLOT_BUDGETS.ontology).toBeGreaterThan(1000);
  });

  it("keeps content after a standard file's first H2 when the context is budgeted", () => {
    const routed = loadRoutedKnowledge("stage_05", {
      deliveryArchetype: "industry_cycle_report",
      maxTotalChars: 5_000,
    });
    expect(routed.context).toContain("## workflow/stages/05_表达/05_投研表达与交付规范.md");
    expect(routed.context).toContain("## 研究员先看什么");
    expect(routed.context).toContain("05 回答：");
    expect(routed.context).toContain("## 9. 质量门槛与返工规则");
    expect(routed.files).toContain("workflow/stages/05_表达/05_投研表达与交付规范.md");
    expect(routed.stats.loaded).toBe(routed.files.length);
    expect(routed.stats.omitted_by_budget).toBeGreaterThan(0);
  });
});

describe("evidence compression", () => {
  it("projects summaries and bundles from drafts", () => {
    const data: any = {
      evidence_drafts: [
        {
          id: "EV-1",
          kind: "fact_draft",
          direction: "support",
          statement: "库存下降",
          judgment_unit_ids: ["JU-1"],
          limitations: [],
        },
        {
          id: "GAP-1",
          kind: "gap",
          direction: "unknown",
          statement: "缺合约价",
          judgment_unit_ids: ["JU-1"],
          limitations: ["缺价"],
        },
      ],
    };
    ensureEvidenceCompressionFields(data, { judgment_units: [{ id: "JU-1" }] });
    expect(data.evidence_summaries.length).toBeGreaterThan(0);
    expect(data.evidence_bundles[0].judgment_unit_id).toBe("JU-1");
    expect(data.evidence_bundles[0].support_evidence_ids).toContain("EV-1");
    expect(data.evidence_bundles[0].gap_ids).toContain("GAP-1");
  });

  it("compacts stage03 for upstream to sample drafts", () => {
    const compacted: any = compactStage03ForUpstream({
      evidence_drafts: [
        { id: "EV-1", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
        { id: "EV-2", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
        { id: "EV-3", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
        { id: "EV-4", kind: "counter", judgment_unit_ids: ["JU-1"] },
        { id: "EV-5", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
        { id: "EV-6", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
        { id: "EV-7", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
        { id: "EV-8", kind: "fact_draft", judgment_unit_ids: ["JU-1"] },
      ],
      evidence_summaries: [{ id: "ESUM-01", statement: "趋势下行" }],
      evidence_bundles: [{
        judgment_unit_id: "JU-1",
        support_evidence_ids: ["EV-1", "EV-2", "EV-3", "EV-5", "EV-6", "EV-7", "EV-8"],
        counter_evidence_ids: ["EV-4"],
        gap_ids: [],
        summary_ids: ["ESUM-01"],
        readiness: "ready",
        notes: [],
      }],
      preparation_markdown: "long preparation text with coverage and gaps",
      document_markdown: "long preparation text with coverage and gaps",
    });
    expect(compacted.preparation_markdown).toBeUndefined();
    expect(compacted.preparation_excerpt).toContain("long preparation");
    expect(compacted.evidence_summaries).toHaveLength(1);
    expect(compacted.evidence_drafts.length).toBeGreaterThanOrEqual(4);
    expect(compacted.evidence_drafts.length).toBeLessThanOrEqual(7);
    expect(compacted.evidence_compression.mode).toBe("bundle_summary_samples");
    expect(compacted.evidence_compression.sample_per_unit).toBe(6);
  });

  it("warns when statement numbers are ungrounded", () => {
    const warnings = collectNumericGroundingWarnings({
      sources: [{ source_quote: "渠道库存处于正常区间" }],
      evidence_summaries: [],
      evidence_drafts: [{
        id: "EV-1",
        kind: "fact_draft",
        statement: "退款率升至 14.6%",
      }],
    });
    expect(warnings.some((w) => w.code === "numeric_ungrounded")).toBe(true);
  });
});
