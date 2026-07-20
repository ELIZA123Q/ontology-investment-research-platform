import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-radar-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let radar: typeof import("@/engine/market_radar");
let workflow: typeof import("@/engine/workflow");
let instanceGraph: typeof import("@/engine/instance_graph");
let sourceSnapshot: typeof import("@/engine/source_snapshot");

beforeAll(async () => {
  db = await import("@/adapters/db");
  radar = await import("@/engine/market_radar");
  workflow = await import("@/engine/workflow");
  instanceGraph = await import("@/engine/instance_graph");
  sourceSnapshot = await import("@/engine/source_snapshot");
});

afterEach(() => {
  vi.unstubAllGlobals();
  sourceSnapshot.setSourceSnapshotDependenciesForTests(null);
});

describe("event-driven research radar", () => {
  it("deduplicates provider results and ignores invalid object mappings", async () => {
    const parent = db.createRun("未来六个月存储芯片库存周期是否改善？", "semiconductor");
    db.createArtifact(parent.id, "stage_04", {
      status: "approved",
      json_content: JSON.stringify({
        judgments: [{
          id: "J-1",
          judgment_unit_id: "JU-1",
          conclusion: "库存处于有条件改善阶段",
          tracking_signals: ["渠道库存周转"],
          invalidation_conditions: ["库存连续两个季度回升"],
        }],
      }),
      approved_at: new Date().toISOString(),
    });

    const provider: import("@/engine/market_radar").MarketEventProvider = {
      name: "fake_provider",
      async discover() {
        return [{
          title: "主要存储厂商调整产量计划",
          summary: "厂商公开披露新的产量安排，可能改变原有库存改善判断。",
          url: "https://example.com/news?id=1&utm_source=test",
          publisher: "Example News",
          occurred_at: "2026-07-18T02:00:00Z",
          published_at: "2026-07-18T03:00:00Z",
          event_type: "supply_update",
          candidate_labels: ["存储芯片", "产量"],
          confidence: "high" as const,
          impacts: [{
            run_id: parent.id,
            judgment_unit_id: "JU-1",
            judgment_id: "J-1",
            matched_condition: "库存连续两个季度回升",
            direction: "weaken" as const,
            impact_classification: "evidence_update" as const,
            relevance: 0.92,
            rationale: "供给调整可能令库存去化慢于原判断。",
          }, {
            run_id: parent.id,
            judgment_unit_id: "JU-NOT-FOUND",
            judgment_id: null,
            matched_condition: null,
            direction: "review" as const,
            impact_classification: "evidence_update" as const,
            relevance: 0.8,
            rationale: "非法对象引用应被丢弃。",
          }],
        }];
      },
    };

    const first = await radar.refreshMarketRadar(provider);
    const second = await radar.refreshMarketRadar(provider);
    expect(first).toMatchObject({ inserted: 1, deduplicated: 0, impacts: 1 });
    expect(second).toMatchObject({ inserted: 0, deduplicated: 1, impacts: 1 });
    expect(db.listMarketEvents()).toHaveLength(1);
    expect(db.listEventImpacts()).toHaveLength(1);
  });

  it("creates an immutable child run and keeps the event as candidate evidence", async () => {
    const parent = db.createRun("事件更新继承测试", "semiconductor");
    db.createArtifact(parent.id, "stage_01", { status: "approved", json_content: "{\"normalized_question\":\"继承范围\"}", approved_at: new Date().toISOString() });
    db.createArtifact(parent.id, "stage_02", { status: "approved", json_content: "{\"judgment_units\":[{\"id\":\"JU-CHILD\"}]}", approved_at: new Date().toISOString() });
    db.upsertSource(parent.id, { url: "https://example.com/parent-source", title: "父运行来源", publisher: "Example", published_at: null, source_type: "disclosure", search_excerpt: "parent" });
    db.saveInstanceGraph(parent.id, { business_instance_graph: {
      schema_name: "ontology_business_instance_graph", schema_version: "1.0.0", authority: "business_parameters",
      objects: [
        { id: "SCOPE-CHILD", type: "ResearchScope", properties: { label: "库存更新范围", dimensions: { domain: "semiconductor" } } },
        { id: "JU-CHILD", type: "JudgmentUnit", properties: { statement: "库存是否改变", judgment_type: "state_measurement", scope_ref: "SCOPE-CHILD" } },
      ],
      relations: [{ id: "REL-JU-SCOPE", type: "unitUsesScope", sourceId: "JU-CHILD", targetId: "SCOPE-CHILD", properties: {} }],
    } }, "parent graph");
    const event = db.upsertMarketEvent({
      dedupe_key: "child-event",
      title: "库存周转出现新变化",
      summary: "公开来源显示库存周转变化，需要重新检查原有判断。",
      url: "https://example.com/child-event",
      publisher: "Example News",
      occurred_at: null,
      published_at: "2026-07-18T04:00:00Z",
      event_type: "inventory_update",
      candidate_labels: ["库存"],
      confidence: "medium",
      refresh_batch_id: "batch-child",
    }).event;
    db.upsertEventImpact({
      event_id: event.id,
      run_id: parent.id,
      judgment_unit_id: "JU-CHILD",
      judgment_id: null,
      matched_condition: null,
      direction: "review",
      impact_classification: "evidence_update",
      relevance: 0.8,
      rationale: "需要更新库存证据。",
    });

    const child = radar.startEventUpdate(event.id, parent.id);
    expect(child.parent_run_id).toBe(parent.id);
    expect(child.trigger_event_id).toBe(event.id);
    expect(child.current_stage).toBe(2);
    expect(db.latestArtifact(child.id, "stage_01", ["approved"])).toBeTruthy();
    expect(db.latestArtifact(child.id, "stage_02", ["approved"])).toBeTruthy();
    expect(db.latestArtifact(child.id, "instance_graph", ["approved"])).toBeTruthy();
    expect(db.latestArtifact(parent.id, "stage_03")).toBeUndefined();
    expect(JSON.parse(child.manifest_json).parent_run.run_id).toBe(parent.id);
    expect(db.listSources(child.id).map((source) => source.source_type)).toEqual(["market_event_candidate"]);
    expect(db.listWorkItems(child.id, "pending")[0]).toMatchObject({ kind: "event_review", stage: "stage_03" });
  });

  it("remaps inherited source IDs into the child graph and does not downgrade verified sources", () => {
    const parent = db.createRun("跨运行来源身份测试", "semiconductor");
    const source = db.upsertSource(parent.id, {
      url: "https://example.com/stable-source", title: "已验证公告", publisher: "Example", published_at: "2026-07-18T00:00:00Z",
      source_type: "disclosure", source_tier: "S2", source_group: "example.com", search_excerpt: "库存下降",
      locator: "quote:库存下降", captured_at: "2026-07-18T01:00:00Z", content_hash: "a".repeat(64),
      usability_status: "usable", failure_category: "", failure_detail: "", final_url: "https://example.com/stable-source",
      content_mime: "text/html", http_status: 200, retrieval_status: "captured", snapshot_text: "库存下降",
      source_quote: "库存下降", quote_verified: true,
    });
    db.saveInstanceGraph(parent.id, { business_instance_graph: {
      schema_name: "ontology_business_instance_graph", schema_version: "1.0.0", authority: "business_parameters",
      objects: [{
        id: source.id,
        type: "SourceDocument",
        properties: { title: source.title, uri: source.url, published_at: source.published_at, source_tier: "S2", source_group: "example.com" },
      }],
      relations: [],
    } });
    const event = db.upsertMarketEvent({
      dedupe_key: "same-as-verified-source", title: "同一公告被雷达发现", summary: "该事件与已验证来源 URL 相同。",
      url: source.url, publisher: "Example", occurred_at: null, published_at: source.published_at,
      event_type: "inventory_update", candidate_labels: ["库存"], confidence: "high", refresh_batch_id: "stable-source-batch",
    }).event;

    const child = radar.startEventUpdate(event.id, parent.id, "evidence_update");
    const childSources = db.listSources(child.id);
    expect(childSources).toHaveLength(1);
    expect(childSources[0]).toMatchObject({
      source_type: "inherited:disclosure", usability_status: "usable", retrieval_status: "captured", quote_verified: 1,
    });
    expect(childSources[0].id).not.toBe(source.id);
    const inheritedGraph = instanceGraph.extractGraph(JSON.parse(db.latestArtifact(child.id, "instance_graph", ["approved"])!.json_content))!;
    expect(inheritedGraph.objects.find((object) => object.type === "SourceDocument")?.id).toBe(childSources[0].id);
  });

  it("recaptures changed sources and marks only their reachable graph descendants stale", async () => {
    const cutoff = "2026-07-18T08:00:00Z";
    const parent = db.createRun("ChangeSet 真实捕获测试", "semiconductor");
    const method = {
      application_id: "MA-INCREMENTAL", method_id: "kb04:A01", method_version: "1.0.0", capability_type: "evidence" as const,
      target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: ["SV-INV"],
      status: "selected" as const,
      precondition_checks: [{ precondition_id: "source_available", result: "pass" as const, evidence_refs: ["EV-1"], reason: "已捕获" }],
      input_evidence_refs: ["EV-1"], output_signal_refs: [], output_judgment_refs: [], execution_summary: "",
      applicability_boundary: "库存事实更新", limitations: [], counter_example_refs: [],
      provenance: { stage: "stage_03" as const, source_application_id: "MA-INCREMENTAL-PLAN", actor: "test", recorded_at: null }, alternatives: [],
    };
    const stage02 = {
      method_applications: [{ ...method, status: "candidate" as const, precondition_checks: [], input_evidence_refs: [], provenance: { ...method.provenance, stage: "stage_02" as const, source_application_id: null } }],
      research_scope: { id: "SCOPE-INC", label: "库存增量范围", dimensions: { domain: "semiconductor" } },
      judgment_units: [{ id: "JU-1", title: "库存", question: "库存是否下降", judgment_type: "state_measurement", scope_ref: "SCOPE-INC", ontology_node_ids: ["SV-INV"], evidence_requirements: ["可定位库存事实"] }],
      variables: [{ id: "SV-INV", name: "inventory", category: "operations", definition: "可比口径库存", variable_kind: "observed", anchors: ["inventory"], ontology_node_id: "StateVariable", role: "target" }],
      paths: [], counter_evidence_directions: ["库存回升"], competing_explanations: ["季节性"],
      document_markdown: "# 结构\n\n冻结库存研究范围、变量、原子判断单元和证据更新边界。",
    };
    db.createArtifact(parent.id, "stage_01", { status: "approved", json_content: "{}", approved_at: cutoff });
    db.createArtifact(parent.id, "stage_02", { status: "approved", json_content: JSON.stringify(stage02), approved_at: cutoff });
    const source = db.upsertSource(parent.id, {
      url: "https://example.com/incremental-source", title: "库存公告", publisher: "Example", published_at: cutoff,
      source_type: "disclosure", source_tier: "S2", source_group: "example.com", search_excerpt: "库存下降",
      locator: "quote:库存下降", captured_at: cutoff, content_hash: "b".repeat(64), usability_status: "usable",
      failure_category: "", failure_detail: "", final_url: "https://example.com/incremental-source", content_mime: "text/html",
      http_status: 200, retrieval_status: "captured", snapshot_text: "库存下降", source_quote: "库存下降", quote_verified: true,
    });
    const sourceDraft = {
      source_id: source.id, source_key: "SRC-1", url: source.url, title: source.title, publisher: source.publisher,
      published_at: cutoff, source_tier: "S2" as const, source_type: "disclosure", search_excerpt: "库存下降",
      locator: "quote:库存下降", source_quote: "库存下降", captured_at: cutoff, content_hash: "b".repeat(64),
      final_url: source.url, retrieval_status: "captured", quote_verified: true,
    };
    const fact = {
      id: "EV-1", statement: "可比口径库存下降", kind: "fact_draft" as const, direction: "support" as const,
      source_keys: ["SRC-1"], source_ids: [source.id], judgment_unit_ids: ["JU-1"], ontology_node_ids: ["SV-INV"],
      subject_ref: "SV-INV", time_basis: "observation_time", scope_ref: "SCOPE-INC", observed_at: cutoff,
      valid_from: cutoff, valid_to: null, published_at: cutoff, cutoff_at: cutoff, directness: "direct" as const, limitations: [],
    };
    const stage03 = { method_applications: [method], sources: [sourceDraft], evidence_drafts: [fact], unresolved_gaps: [], document_markdown: "# 证据\n\n已验证公告原文、精确定位、发布日期、观察时间和事实口径，并冻结来源哈希，供增量更新与父子运行回放测试使用。" };
    const baseArtifact = db.createArtifact(parent.id, "stage_03", { status: "approved", json_content: JSON.stringify(stage03), markdown_content: stage03.document_markdown, approved_at: cutoff });
    let graph = instanceGraph.emptyGraph();
    graph = instanceGraph.materializeStageIntoGraph(graph, "stage_02", stage02);
    graph = instanceGraph.materializeStageIntoGraph(graph, "stage_03", stage03);
    db.saveInstanceGraph(parent.id, { business_instance_graph: graph });
    const event = db.upsertMarketEvent({
      dedupe_key: "incremental-recapture-event", title: "库存公告更新", summary: "同一来源正文出现新版本。",
      url: "https://example.com/event-only", publisher: "Example", occurred_at: null, published_at: cutoff,
      event_type: "inventory_update", candidate_labels: ["库存"], confidence: "high", refresh_batch_id: "incremental-batch",
    }).event;
    const child = radar.startEventUpdate(event.id, parent.id, "evidence_update");
    const childSource = db.listSources(child.id).find((item) => item.normalized_url.includes("incremental-source"))!;
    const inheritedGraph = instanceGraph.extractGraph(JSON.parse(db.latestArtifact(child.id, "instance_graph", ["approved"])!.json_content))!;
    expect(inheritedGraph.objects.some((object) => object.id === childSource.id)).toBe(true);

    const quote = "库存同比进一步下降";
    const body = `<html><article>${quote.repeat(30)}</article></html>`;
    sourceSnapshot.setSourceSnapshotDependenciesForTests({
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      requestResolved: async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
    });
    const newSource = { ...sourceDraft, source_id: childSource.id, source_quote: quote, locator: `quote:${quote}`, content_hash: "f".repeat(64), quote_verified: false };
    const artifact = await workflow.applyIncrementalChangeSet(child.id, {
      target_stage: "stage_03", trigger_event_id: event.id, base_artifact_id: baseArtifact.id,
      base_artifact_hash: createHash("sha256").update(baseArtifact.json_content).digest("hex"), target_attempt: 1,
      expected_graph_version: 1, affected_stage_refs: ["stage_03", "stage_04", "stage_05"], affected_object_refs: ["SRC-1"],
      rationale: "来源正文更新，必须重新捕获并局部失效", upserts: { sources: [newSource] }, removals: {},
    });
    expect(artifact.status).toBe("needs_review");
    const refreshed = db.listSources(child.id).find((item) => item.id === childSource.id)!;
    expect(refreshed.content_hash).toBe(createHash("sha256").update(body).digest("hex"));
    expect(refreshed.content_hash).not.toBe("f".repeat(64));
    expect(refreshed).toMatchObject({ usability_status: "usable", retrieval_status: "captured", quote_verified: 1 });
    const staleGraph = instanceGraph.extractGraph(JSON.parse(db.latestArtifact(child.id, "instance_graph", ["approved"])!.json_content))!;
    const staleIds = new Set(staleGraph.objects.filter((object) => object.properties?.validity_status === "stale").map((object) => object.id));
    expect(staleIds).toEqual(new Set([childSource.id, "CL-EV-1-1", "EV-1"]));
    expect(staleIds.has("JU-1")).toBe(false);
    expect(staleIds.has("SV-INV")).toBe(false);
  });

  it.each([
    ["evidence_update", 2, true, true, true, "stage_03"],
    ["structure_revision", 1, true, false, false, "stage_02"],
    ["scope_revision", 0, false, false, false, "stage_01"],
  ] as const)("applies %s inheritance and restart boundary", (classification, currentStage, hasStage1, hasStage2, hasGraph, workStage) => {
    const parent = db.createRun(`分类继承-${classification}`, "semiconductor");
    db.createArtifact(parent.id, "stage_01", { status: "approved", json_content: "{}", approved_at: new Date().toISOString() });
    db.createArtifact(parent.id, "stage_02", { status: "approved", json_content: "{}", approved_at: new Date().toISOString() });
    db.saveInstanceGraph(parent.id, { business_instance_graph: { schema_name: "ontology_business_instance_graph", schema_version: "1.0.0", authority: "business_parameters", objects: [], relations: [] } });
    const event = db.upsertMarketEvent({
      dedupe_key: `classification-${classification}`,
      title: `分类事件 ${classification}`,
      summary: "用于验证影响分类与子运行继承边界。",
      url: `https://example.com/${classification}`,
      publisher: "Example",
      occurred_at: null,
      published_at: null,
      event_type: "test",
      candidate_labels: [],
      confidence: "medium",
      refresh_batch_id: "classification-batch",
    }).event;
    const child = radar.startEventUpdate(event.id, parent.id, classification);
    expect(child.trigger_classification).toBe(classification);
    expect(child.current_stage).toBe(currentStage);
    expect(Boolean(db.latestArtifact(child.id, "stage_01", ["approved"]))).toBe(hasStage1);
    expect(Boolean(db.latestArtifact(child.id, "stage_02", ["approved"]))).toBe(hasStage2);
    expect(Boolean(db.latestArtifact(child.id, "instance_graph", ["approved"]))).toBe(hasGraph);
    expect(db.listWorkItems(child.id, "pending")[0].stage).toBe(workStage);
  });

  it("reports a missing DeepSeek API key before attempting a web search", async () => {
    const original = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    await expect(new radar.DeepSeekMarketEventProvider().discover({ lookbackHours: 72, runs: [] }))
      .rejects.toThrow(/DEEPSEEK_API_KEY/);
    if (original) process.env.DEEPSEEK_API_KEY = original;
  });
});
