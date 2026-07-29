import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  collectStage03ConsistencyIssues,
  ensureStage03DocumentFields,
  recomputeStage03EvidenceQualityGate,
} from "@/engine/stage03_documents";
import { evaluateEvidenceQuality } from "@/engine/evidence_quality_gate";
import { buildEvidenceGapFallback } from "@/engine/workflow_projections";
import { mapIndependentReviewToSemanticYaml } from "@/engine/formal_semantic_review";
import { clipUpstreamJsonSoft } from "@/engine/context_assembler";
import YAML from "yaml";

describe("round4 quality drains", () => {
  it("stage03 approval fails when evidence_quality_gate is omitted", () => {
    const issues = collectStage03ConsistencyIssues({
      preparation_markdown: "# 准备\n\n".padEnd(820, "x"),
      document_markdown: "# 准备\n\n".padEnd(820, "x"),
      instance_manifest_yaml: "metadata:\n  task_id: T\n",
      evidence_drafts: [{ id: "EV-1", kind: "fact_draft", statement: "价涨", source_keys: ["SRC-1"] }],
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
      mcp_channel_usage: { mcp_evidence_calls: 2 },
    });
    expect(issues.some((item) => item.code === "evidence_quality_gate_missing")).toBe(true);
  });

  it("recompute gate blocks single-source JU when independence requires 2", () => {
    const recomputed = recomputeStage03EvidenceQualityGate(
      {
        evidence_drafts: [{
          id: "EV-1",
          kind: "fact_draft",
          judgment_unit_ids: ["JU-1"],
          source_ids: ["SRC-1"],
          directness: "direct",
        }],
        quality_status: "high_quality_pass",
      },
      {
        structure: {
          judgment_units: [{ id: "JU-1", judgment_type: "state" }],
          evidence_requirements: [{
            id: "ER-1",
            evidence_role: "support",
            minimum_independent_sources: 2,
            judgment_unit_ids: ["JU-1"],
          }],
        },
        sources: [{
          id: "SRC-1",
          publisher: "Example",
          source_group: "g1",
          url: "https://example.com/a",
          final_url: "https://example.com/a",
          usability_status: "usable",
          retrieval_status: "captured",
          quote_verified: true,
        } as any],
      },
    );
    expect(recomputed.evidence_quality_gate.passed).toBe(false);
    expect(recomputed.quality_status).toBe("return_required");
    expect(recomputed.evidence_readiness).toBe("not_ready");
    expect(recomputed.allowed_05_output).toBe("bounded_report");
  });

  it("promotes a fully revalidated Stage03 instead of preserving stale minimum_pass", () => {
    const sources = ["g1", "g2", "g3", "g1", "g2"].map((group, index) => ({
      id: `SRC-${index + 1}`,
      url: `https://${group}.example/${index + 1}`,
      title: `source ${index + 1}`,
      publisher: group,
      source_group: group,
      usability_status: "usable",
      retrieval_status: "captured",
      quote_verified: 1,
    })) as any;
    const evidence = sources.map((source: any, index: number) => ({
      id: `EV-${index + 1}`,
      kind: index === 4 ? "counter" : "fact_draft",
      direction: index === 4 ? "weaken" : "support",
      statement: `可核验陈述 ${index + 1}`,
      judgment_unit_ids: ["JU-1"],
      source_ids: [source.id],
      source_keys: [source.id],
      directness: "direct",
      limitations: [],
    }));
    const recomputed = recomputeStage03EvidenceQualityGate({
      evidence_drafts: evidence,
      sources: evidence.map((item: any) => ({
        source_key: item.source_keys[0],
        source_id: item.source_ids[0],
      })),
      preparation_markdown: "# 数据与证据准备\n\n".padEnd(900, "证据覆盖、反证、来源上限与交付边界。"),
      document_markdown: "# 数据与证据准备\n\n".padEnd(900, "证据覆盖、反证、来源上限与交付边界。"),
      quality_status: "minimum_pass",
      deterministic_check_status: "not_checked",
      mcp_channel_usage: { controlled_projection: true },
    }, {
      structure: {
        judgment_units: [{ id: "JU-1", judgment_type: "cycle_phase" }],
        evidence_requirements: [
          {
            id: "ER-S",
            evidence_role: "support",
            minimum_independent_sources: 2,
            judgment_unit_ids: ["JU-1"],
          },
          {
            id: "ER-C",
            evidence_role: "counter",
            minimum_independent_sources: 2,
            judgment_unit_ids: ["JU-1"],
          },
        ],
      },
      sources,
    });
    expect(recomputed.evidence_quality_gate.quality_status).toBe("high_quality_pass");
    expect(recomputed.quality_status).toBe("high_quality_pass");
    expect(recomputed.deterministic_check_status).toBe("checked");
    expect(recomputed.return_required).toBe(false);
  });

  it("recomputes coverage, summaries, and bundles after a gap baseline gains facts", () => {
    const structure = {
      judgment_units: [
        { id: "JU-1", title: "HBM" },
        { id: "JU-2", title: "NAND" },
      ],
    };
    const data: any = {
      evidence_drafts: [
        {
          id: "GAP-1",
          kind: "gap",
          direction: "unknown",
          judgment_unit_ids: ["JU-1"],
          source_keys: [],
          source_ids: [],
        },
        {
          id: "GAP-2",
          kind: "gap",
          direction: "unknown",
          judgment_unit_ids: ["JU-2"],
          source_keys: [],
          source_ids: [],
        },
      ],
      evidence_summaries: [{
        id: "ES-STALE",
        evidence_draft_ids: ["GAP-1"],
        judgment_unit_ids: ["JU-1"],
        statement: "旧 gap 摘要",
      }],
      evidence_bundles: [{
        judgment_unit_id: "JU-1",
        support_evidence_ids: [],
        counter_evidence_ids: [],
        gap_ids: ["GAP-1"],
        summary_ids: ["ES-STALE"],
        readiness: "not_ready",
        notes: ["保留人工备注"],
      }],
      sources: [],
      unresolved_gaps: ["GAP-1", "GAP-2"],
      required_coverage_rate: 0.5,
    };
    ensureStage03DocumentFields(data, { structure });
    expect(data.evidence_coverage_rate).toBe(0);

    data.evidence_drafts = [
      {
        id: "EV-1",
        kind: "fact_draft",
        direction: "support",
        judgment_unit_ids: ["JU-1"],
        source_keys: ["SRC-1"],
        source_ids: ["SRC-1"],
        statement: "HBM 形成可核验事实",
      },
      {
        id: "EV-2",
        kind: "counter",
        direction: "weaken",
        judgment_unit_ids: ["JU-2"],
        source_keys: ["SRC-2"],
        source_ids: ["SRC-2"],
        statement: "NAND 存在可核验反证",
      },
    ];
    data.sources = [{ source_key: "SRC-1" }, { source_key: "SRC-2" }];
    ensureStage03DocumentFields(data, { structure });
    expect(data.evidence_backed_unit_count).toBe(2);
    expect(data.evidence_coverage_rate).toBe(1);
    expect(data.evidence_readiness).toBe("ready");
    expect(data.evidence_summaries.some((item: any) => item.id === "ES-STALE")).toBe(false);
    expect(data.evidence_summaries.flatMap((item: any) => item.evidence_draft_ids))
      .toEqual(expect.arrayContaining(["EV-1", "EV-2"]));
    expect(data.evidence_bundles.find((item: any) => item.judgment_unit_id === "JU-1"))
      .toMatchObject({
        support_evidence_ids: ["EV-1"],
        gap_ids: [],
        readiness: "ready",
        notes: ["保留人工备注"],
      });
    expect(data.evidence_bundles.find((item: any) => item.judgment_unit_id === "JU-2"))
      .toMatchObject({
        counter_evidence_ids: ["EV-2"],
        gap_ids: [],
      });
  });

  it("evidence gate blocks missing required counter role", () => {
    const result = evaluateEvidenceQuality({
      evidenceDrafts: [{
        id: "EV-1",
        kind: "fact_draft",
        judgment_unit_ids: ["JU-1"],
        source_ids: ["SRC-1"],
        directness: "direct",
      }],
      sources: [{
        id: "SRC-1",
        publisher: "A",
        source_group: "g1",
        url: "https://a.example",
        final_url: "https://a.example",
        usability_status: "usable",
        retrieval_status: "captured",
        quote_verified: true,
      } as any],
      judgmentUnits: [{ id: "JU-1" }],
      evidenceRequirements: [{
        id: "ER-C",
        evidence_role: "counter",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
      }],
    });
    expect(result.passed).toBe(false);
    expect(result.gapDetails.some((d) => d.missing.includes("反证"))).toBe(true);
  });

  it("does not treat an ordinary support gap as a recorded counter check", () => {
    const result = evaluateEvidenceQuality({
      evidenceDrafts: [
        {
          id: "EV-1",
          kind: "fact_draft",
          judgment_unit_ids: ["JU-1"],
          source_ids: ["SRC-1"],
          directness: "direct",
        },
        {
          id: "GAP-SUPPORT",
          kind: "gap",
          evidence_role: "support",
          judgment_unit_ids: ["JU-1"],
          source_ids: [],
        },
      ],
      sources: [{
        id: "SRC-1",
        publisher: "A",
        source_group: "g1",
        url: "https://a.example",
        usability_status: "usable",
        retrieval_status: "captured",
        quote_verified: true,
      } as any],
      judgmentUnits: [{ id: "JU-1" }],
      evidenceRequirements: [{
        id: "ER-C",
        evidence_role: "counter",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
      }],
    });
    expect(result.passed).toBe(false);
    expect(result.gapDetails.some((d) => d.missing.includes("反证角色未登记"))).toBe(true);
  });

  it("records an explicit counter gap but caps the result below high quality", () => {
    const sources = ["A", "B", "C"].map((group, index) => ({
      id: `SRC-${index + 1}`,
      publisher: group,
      source_group: group,
      url: `https://${group.toLowerCase()}.example`,
      usability_status: "usable",
      retrieval_status: "captured",
      quote_verified: true,
    })) as any[];
    const result = evaluateEvidenceQuality({
      evidenceDrafts: [
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `EV-${index + 1}`,
          kind: "fact_draft",
          judgment_unit_ids: ["JU-1"],
          source_ids: [`SRC-${(index % 3) + 1}`],
          directness: index < 2 ? "direct" as const : "indirect" as const,
        })),
        {
          id: "GAP-COUNTER",
          kind: "gap",
          evidence_role: "counter",
          judgment_unit_ids: ["JU-1"],
          source_ids: [],
        },
      ],
      sources,
      judgmentUnits: [{ id: "JU-1" }],
      evidenceRequirements: [{
        id: "ER-C",
        evidence_role: "counter",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
      }],
    });
    expect(result.passed).toBe(true);
    expect(result.qualityStatus).toBe("minimum_pass");
    expect(result.gapDetails.some((d) => d.missing.includes("反证要求已显式登记为 gap"))).toBe(true);
  });

  it("projects Stage02 counter requirements into the Stage03 gap baseline", () => {
    const data = buildEvidenceGapFallback({
      judgment_units: [{
        id: "JU-1",
        title: "周期阶段",
        evidence_requirements: ["价格和库存序列"],
        ontology_node_ids: [],
      }],
      evidence_requirements: [
        {
          id: "ER-S",
          requirement: "价格和库存序列",
          evidence_role: "support",
          minimum_independent_sources: 2,
          judgment_unit_ids: ["JU-1"],
        },
        {
          id: "ER-C",
          requirement: "排除供给收缩造成的假改善",
          evidence_role: "counter",
          minimum_independent_sources: 1,
          judgment_unit_ids: ["JU-1"],
        },
      ],
      method_applications: [],
    }, "初始化批次取证");
    expect(data.evidence_drafts).toHaveLength(2);
    expect(data.evidence_drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_role: "counter",
        requirement: "排除供给收缩造成的假改善",
      }),
    ]));
  });

  it("formal mapper does not promote bare pass to five check passes", () => {
    const parsed = YAML.parse(mapIndependentReviewToSemanticYaml({
      reviewData: { verdict: "pass", reviewer_model: "r1" },
      stageHashes: { stage_02: "a", stage_03: "b", stage_04: "c", stage_05: "d" },
      contractVersion: "1.3.0",
      producerId: "p1",
    }));
    expect(parsed.verdict).toBe("needs_human");
  });

  it("clipUpstreamJsonSoft actually reduces oversized upstream", () => {
    const upstream = [{
      kind: "stage_03",
      json: {
        preparation_excerpt: "准备".repeat(5_000),
        evidence_drafts: Array.from({ length: 40 }, (_, i) => ({ id: `EV-${i}`, statement: "x".repeat(200) })),
        sources: Array.from({ length: 40 }, (_, i) => ({ id: `S-${i}`, quote: "q".repeat(200) })),
      },
    }];
    const clipped = clipUpstreamJsonSoft(upstream, 8_000);
    expect(clipped.clipped).toBe(true);
    expect(clipped.final_chars).toBeLessThan(clipped.original_chars);
    expect(clipped.final_chars).toBeLessThanOrEqual(8_000 + 2_000); // allow residual after soft shrink
  });
});
