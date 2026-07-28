import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "@/adapters/repo-paths";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-stage04-recompute-${process.pid}.sqlite`;
process.env.WORKBENCH_EXPORT_ROOT = `/tmp/ontology-workbench-stage04-recompute-exports-${process.pid}`;

let db: typeof import("@/adapters/db");
let workflowShared: typeof import("@/engine/workflow_shared");
let semanticExecution: typeof import("@/engine/semantic_execution");
let graphContract: typeof import("@/engine/graph_contract");
let instanceGraph: typeof import("@/engine/instance_graph");

const cutoff = "2026-07-18T08:00:00Z";

beforeAll(async () => {
  db = await import("@/adapters/db");
  workflowShared = await import("@/engine/workflow_shared");
  semanticExecution = await import("@/engine/semantic_execution");
  graphContract = await import("@/engine/graph_contract");
  instanceGraph = await import("@/engine/instance_graph");
});

function forgePassRules(judgmentId: string) {
  return semanticExecution.REQUIRED_RULES.map((rule, index) => ({
    id: `RE-FORGE-${index + 1}`,
    rule_ref: rule,
    judgment_id: judgmentId,
    input_refs: ["EV-1"],
    condition_results: [{ condition_id: "forged", expression: "pass", input_refs: ["EV-1"], outcome: "pass" as const, rationale: "forged" }],
    result: "pass" as const,
    deterministic_result: {
      engine_version: semanticExecution.ENGINE_VERSION,
      result: "pass" as const,
      rationale: "forged all pass",
      evaluated_at: cutoff,
    },
  }));
}

describe("stage04 recompute guard", () => {
  it("overwrites forged all-pass deterministic_result when Stage03 evidence fails time alignment", () => {
    const run = db.createRun("伪造规则不可确认", "semiconductor");
    const source = db.upsertSource(run.id, {
      url: "https://example.com/forge-source",
      title: "伪造测试来源",
      publisher: "Example",
      published_at: "2026-07-18",
      source_type: "disclosure",
      source_tier: "S2",
      source_group: "example.com",
      search_excerpt: "经营数据",
      locator: "quote:经营数据",
      captured_at: cutoff,
      content_hash: "a".repeat(64),
      usability_status: "usable",
      failure_category: "",
      failure_detail: "",
      final_url: "https://example.com/forge-source",
      content_mime: "text/html",
      http_status: 200,
      retrieval_status: "captured",
      snapshot_text: "经营数据",
      source_quote: "经营数据",
      quote_verified: true,
    });

    db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify({
        research_scope: { id: "SCOPE-1", label: "经营观察", dimensions: { domain: "semiconductor" } },
        judgment_units: [{
          id: "JU-1",
          title: "经营状态",
          question: "经营是否改善",
          judgment_type: "state_measurement",
          scope_ref: "SCOPE-1",
          ontology_node_ids: [],
          evidence_requirements: ["可核验经营事实"],
        }],
      }),
      markdown_content: "# 结构",
    });

    db.createArtifact(run.id, "stage_03", {
      status: "approved",
      json_content: JSON.stringify({
        evidence_drafts: [{
          id: "EV-1",
          statement: "公司披露本期经营数据",
          source_ids: [source.id],
          scope_ref: "SCOPE-1",
          observed_at: "2026-07-19T00:00:00Z",
          valid_from: "2026-07-19T00:00:00Z",
          valid_to: null,
          published_at: "2026-07-19T00:00:00Z",
          cutoff_at: cutoff,
          directness: "direct",
          limitations: [],
        }],
      }),
      markdown_content: "# 证据",
    });

    const forgedRules = forgePassRules("J-1");
    const forged: any = {
      signals: [{ id: "S-1", evidence_draft_ids: ["EV-1"], target_hypothesis_ids: ["H-1"] }],
      hypotheses: [{ id: "H-1", signal_ids: ["S-1"], statement: "经营改善" }],
      competing_explanations: [],
      rule_evaluations: forgedRules,
      judgments: [{
        id: "J-1",
        judgment_unit_id: "JU-1",
        title: "经营状态判断",
        conclusion: "现有事实形成强判断",
        strength: "J4",
        level: "J4",
        decision_status: "supported",
        conflict_status: "none",
        scope_ref: "SCOPE-1",
        cutoff_at: cutoff,
        supporting_evidence_draft_ids: ["EV-1"],
        counter_evidence_draft_ids: [],
        hypothesis_ids: ["H-1"],
        rule_evaluation_ids: forgedRules.map((item) => item.id),
      }],
      reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["J-1", ...forgedRules.map((item) => item.id)] }],
      document_markdown: "# 判断\n\n伪造全 pass 的 J4。",
    };

    // 若只信任稿内 deterministic_result，伪造全 pass 可通过断言。
    expect(() => semanticExecution.assertDeterministicRuleResults(forged)).not.toThrow();
    expect(forged.judgments[0].strength).toBe("J4");

    workflowShared.recomputeStage04DeterministicRules(run.id, forged);

    expect(forged.judgments[0].strength).toBe("J0");
    expect(forged.judgments[0].level).toBe("J0");
    expect(forged.rule_evaluations.some((item: any) =>
      String(item.id).startsWith("RE-SYS-")
      && item.rule_ref === "evidence_scope_time_alignment"
      && item.deterministic_result?.result !== "pass")).toBe(true);
    expect(forged.rule_evaluations.every((item: any) => item.id.startsWith("RE-FORGE-"))).toBe(false);
  });

  it("accepts WaferFab via projects_to/extends chain on Asset-scoped endpoints", () => {
    const graph = instanceGraph.emptyGraph();
    graph.objects.push(
      {
        id: "SCOPE-1",
        type: "ResearchScope",
        properties: { label: "设施范围", dimensions: { domain: "semiconductor" } },
      },
      {
        id: "FAB-1",
        type: "WaferFab",
        properties: {
          name: "十二英寸晶圆厂",
          wafer_sizes: ["12"],
        },
      },
    );
    graph.relations.push({
      id: "REL-SCOPE-FAB",
      type: "scopeIncludesObject",
      sourceId: "SCOPE-1",
      targetId: "FAB-1",
      properties: { dimension: "facility" },
    });
    expect(() => graphContract.validateRuntimeGraph(graph)).not.toThrow();
  });

  it("derives REQUIRED_RULES from blocking runtime_semantic_execution registry entries", () => {
    const registry = YAML.parse(readFileSync(repositoryPath("governance", "02_合同", "rule_authority_registry.yaml"), "utf8")) as any;
    const formal = registry.formal_ontology_rules || {};
    const blockingSemantic = Object.entries(formal)
      .filter(([, value]: [string, any]) =>
        value?.execution_surface === "runtime_semantic_execution" && value?.blocking === true)
      .map(([id]) => id)
      .sort();
    expect([...semanticExecution.REQUIRED_RULES].sort()).toEqual(blockingSemantic);
    expect(semanticExecution.loadBlockingSemanticRuleIds()).toEqual(blockingSemantic);
    expect(formal.expectation_projection_integrity).toMatchObject({
      execution_surface: "runtime_semantic_execution",
      blocking: true,
    });
  });
});
