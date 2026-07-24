import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { collectStage03ConsistencyIssues, recomputeStage03EvidenceQualityGate } from "@/engine/stage03_documents";
import { evaluateEvidenceQuality } from "@/engine/evidence_quality_gate";
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
        } as any],
      },
    );
    expect(recomputed.evidence_quality_gate.passed).toBe(false);
    expect(recomputed.quality_status).toBe("return_required");
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
