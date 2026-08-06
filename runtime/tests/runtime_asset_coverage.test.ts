import { describe, expect, it } from "vitest";
import { registeredFiles } from "@/skills/method_selection/knowledge_loader";
import {
  criticalMissingAssets,
  expectedKnowledgeMismatch,
  knowledgeCoverageGaps,
  loadRuntimeAssetCoverage,
  missingCriticalPaths,
} from "@/runtime_asset_coverage";

describe("runtime asset coverage matrix", () => {
  it("loads coverage schema and has no missing_critical critical assets", () => {
    const coverage = loadRuntimeAssetCoverage();
    expect(coverage.schema_name).toBe("runtime_asset_coverage");
    expect(coverage.assets.length).toBeGreaterThan(10);
    expect(criticalMissingAssets(coverage)).toEqual([]);
  });

  it("critical asset paths exist on disk", () => {
    expect(missingCriticalPaths()).toEqual([]);
  });

  it("knowledge_expected matches runtime_contexts registered files", () => {
    expect(expectedKnowledgeMismatch()).toEqual([]);
  });

  it("Stage03 knowledge includes B03 and OPS_MCP", () => {
    const files = registeredFiles("stage_03");
    expect(files).toContain("knowledge/evidence_strategy/B03_MCP通道注册.md");
    expect(files).toContain("knowledge/evidence_strategy/OPS_MCP查询快速参考.md");
  });

  it("knowledge-mode critical assets are registered for their stages", () => {
    expect(knowledgeCoverageGaps()).toEqual([]);
  });
});
