import { describe, expect, it } from "vitest";
import {
  assembleStageContext,
  buildSemanticRoute,
  CONTEXT_SLOT_BUDGETS,
  loadRoutedKnowledge,
} from "@/workflow/context_assembler";
import { buildGovernanceFingerprint } from "@/governance_fingerprint";
import {
  BODY_TOTAL_CHARS,
  buildStageGenerationGuidance,
  dedupeMethodGuidance,
} from "@/skills/method_selection/method_guidance";
import { loadMethodRegistry } from "@/skills/method_selection/method_registry";
import { compactStage03ForUpstream, compactStage04ForStage05 } from "@/workflow/support";
import { ensureEvidenceCompressionFields, collectNumericGroundingWarnings } from "@/agents/03_evidence/input_contract";

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
    expect(routed.context).toContain("## tasks/workflows/deep_research/stages/05_delivery.md");
    expect(routed.context).toContain("## 研究员先看什么");
    expect(routed.context).toContain("05 回答：");
    expect(routed.context).toContain("## 9. 质量门槛与返工规则");
    expect(routed.files).toContain("tasks/workflows/deep_research/stages/05_delivery.md");
    expect(routed.stats.loaded).toBe(routed.files.length);
    expect(routed.stats.omitted_by_budget).toBeGreaterThan(0);
    const injection = routed.file_injections.find(
      (item) => item.file === "tasks/workflows/deep_research/stages/05_delivery.md",
    );
    expect(injection?.loaded).toBe(true);
    expect(injection?.included_chars).toBeGreaterThan(0);
    expect(injection?.content_hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("does not mark files as loaded when budget leaves zero body", () => {
    const routed = loadRoutedKnowledge("stage_05", {
      deliveryArchetype: "industry_cycle_report",
      maxTotalChars: 2_100,
    });
    for (const item of routed.file_injections) {
      if (item.loaded) {
        expect(item.included_chars).toBeGreaterThan(0);
        expect(item.omitted_reason).toBeNull();
      } else {
        expect(item.included_chars).toBe(0);
        expect(item.omitted_reason).toBeTruthy();
      }
    }
    expect(routed.stats.loaded).toBe(routed.file_injections.filter((item) => item.loaded).length);
    expect(routed.files).toEqual(routed.file_injections.filter((item) => item.loaded).map((item) => item.file));
  });

  it("exposes source vs injected knowledge versions in assembleStageContext", () => {
    const assembled = assembleStageContext({
      kind: "stage_05",
      upstream: [],
      ontologyObjectSet: "ontology-slice-text",
      deliveryArchetype: "industry_cycle_report",
    });
    expect(assembled.knowledge_source_version).toMatch(/^sha256:/);
    expect(assembled.knowledge_version).toMatch(/^sha256:/);
    expect(assembled.file_injections.length).toBeGreaterThan(0);
    expect(assembled.standards_loading.files_loaded).toBe(
      assembled.file_injections.filter((item) => item.loaded).length,
    );
  });
});

describe("method_guidance budget and dedupe", () => {
  it("binds BODY_TOTAL_CHARS to CONTEXT_SLOT_BUDGETS.method_guidance", () => {
    expect(BODY_TOTAL_CHARS).toBe(CONTEXT_SLOT_BUDGETS.method_guidance);
  });

  it("dedupes identical method bodies by id and content hash", () => {
    const deduped = dedupeMethodGuidance([
      { method_id: "kb03:A01", file: "a.md", excerpt: "same", truncated: false, excerpt_mode: "full" },
      { method_id: "kb03:A01", file: "a.md", excerpt: "same", truncated: false, excerpt_mode: "full" },
      { method_id: "kb03:A02", file: "b.md", excerpt: "same", truncated: false, excerpt_mode: "full" },
      { method_id: "kb03:A03", file: "c.md", excerpt: "other", truncated: false, excerpt_mode: "full" },
    ]);
    expect(deduped.map((item) => item.method_id)).toEqual(["kb03:A01", "kb03:A03"]);
  });

  it("respects totalChars when building stage guidance", () => {
    const registry = loadMethodRegistry();
    const candidates = [
      registry.get("kb03:A03")!,
      registry.get("kb03:A01")!,
    ].filter(Boolean);
    const guidance = buildStageGenerationGuidance({
      kind: "stage_03",
      candidates,
      taskText: "存储周期",
      totalChars: 1_000,
    });
    const total = guidance.selected_method_guidance.reduce((sum, item) => sum + item.excerpt.length, 0);
    expect(total).toBeLessThanOrEqual(1_000);
    expect(guidance.guidance_budget).toBe(1_000);
  });
});

describe("governance_fingerprint", () => {
  it("changes when injected ontology or method guidance changes", () => {
    const base = buildGovernanceFingerprint({
      knowledge_source_version: "sha256:src",
      knowledge_injected_version: "sha256:inj",
      knowledge_files: ["a.md"],
      knowledge_file_injections: [{
        file: "a.md",
        included_chars: 10,
        truncated: false,
        omitted_reason: null,
        content_hash: "aaaaaaaaaaaaaaaa",
        loaded: true,
      }],
      ontology_injected_text: "ontology-v1",
      ontology_files: ["ontology.yaml"],
      method_guidance: [{
        method_id: "kb03:A01",
        file: "methods/a.md",
        excerpt: "body-1",
        truncated: false,
        excerpt_mode: "full",
        content_hash: "bbbbbbbbbbbbbbbb",
      }],
      scenario_card_ids: [],
      structured_keys: ["mcp_channel_hints"],
    });
    const ontologyChanged = buildGovernanceFingerprint({
      knowledge_source_version: "sha256:src",
      knowledge_injected_version: "sha256:inj",
      knowledge_files: ["a.md"],
      knowledge_file_injections: base.detail.knowledge.file_injections,
      ontology_injected_text: "ontology-v2",
      ontology_files: ["ontology.yaml"],
      method_guidance: [{
        method_id: "kb03:A01",
        file: "methods/a.md",
        excerpt: "body-1",
        truncated: false,
        excerpt_mode: "full",
        content_hash: "bbbbbbbbbbbbbbbb",
      }],
      scenario_card_ids: [],
      structured_keys: ["mcp_channel_hints"],
    });
    const guidanceChanged = buildGovernanceFingerprint({
      knowledge_source_version: "sha256:src",
      knowledge_injected_version: "sha256:inj",
      knowledge_files: ["a.md"],
      knowledge_file_injections: base.detail.knowledge.file_injections,
      ontology_injected_text: "ontology-v1",
      ontology_files: ["ontology.yaml"],
      method_guidance: [{
        method_id: "kb03:A01",
        file: "methods/a.md",
        excerpt: "body-2",
        truncated: false,
        excerpt_mode: "full",
        content_hash: "cccccccccccccccc",
      }],
      scenario_card_ids: [],
      structured_keys: ["mcp_channel_hints"],
    });
    expect(base.governance_version).not.toBe(ontologyChanged.governance_version);
    expect(base.governance_version).not.toBe(guidanceChanged.governance_version);
    expect(base.detail.knowledge.injected_version).toBe("sha256:inj");
    expect(base.detail.ontology.injected_version).toMatch(/^sha256:/);
    expect(base.detail.method_guidance.injected_version).toMatch(/^sha256:/);
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

  it("compacts stage04 to a judgment handoff for stage05", () => {
    const source = {
      rule_evaluations: Array.from({ length: 65 }, (_, index) => ({
        id: `RE-${index}`,
        rule_ref: "judgment_evidence_threshold",
        deterministic_result: { rationale: "long audit rationale".repeat(20) },
      })),
      reasoning_traces: [{ id: "RT-1", node_ids: Array.from({ length: 100 }, (_, index) => `N-${index}`) }],
      reasoning_audit_yaml: "audit: ".padEnd(10_000, "x"),
      judgment_brief_markdown: "# 判断简报\n".padEnd(5_000, "x"),
      semantic_context: { graph: "x".repeat(20_000) },
      judgments: [{
        id: "J-1",
        judgment_unit_id: "JU-1",
        title: "HBM",
        conclusion: "需求强但经济性边际承压",
        rationale: "两条独立来源支持",
        strength: "J2",
        confidence: "medium",
        decision_status: "supported",
        conditions: ["客户库存不累积"],
        supporting_evidence_draft_ids: ["EV-1"],
        counter_evidence_draft_ids: ["EV-2"],
        method_application_ids: ["MA-1"],
        uncertainties: ["库存未知"],
        invalidation_conditions: ["价格斜率转负"],
        tracking_signals: ["价格斜率"],
      }],
      expression_permission: { allowed_core_claims: ["J-1"], max_expression_level: "J2" },
    };
    const compacted: any = compactStage04ForStage05(source);
    expect(compacted.rule_evaluations).toBeUndefined();
    expect(compacted.reasoning_audit_yaml).toBeUndefined();
    expect(compacted.semantic_context).toBeUndefined();
    expect(compacted.judgments[0]).toMatchObject({
      id: "J-1",
      conclusion: "需求强但经济性边际承压",
      supporting_evidence_draft_ids: ["EV-1"],
      invalidation_conditions: ["价格斜率转负"],
    });
    expect(compacted.expression_permission.max_expression_level).toBe("J2");
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(source).length / 5);
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
