import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-v13-${process.pid}.sqlite`;
process.env.WORKBENCH_EXPORT_ROOT = `/tmp/ontology-workbench-v13-exports-${process.pid}`;

let db: typeof import("@/adapters/db");
let instanceGraph: typeof import("@/engine/instance_graph");
let actionExecutor: typeof import("@/engine/action_executor");
let ontologyTools: typeof import("@/engine/ontology_tools");
let ontologyAdapter: typeof import("@/adapters/ontology");
let publish: typeof import("@/adapters/publish_package");
let workflow: typeof import("@/engine/workflow");
let deepseek: typeof import("@/adapters/deepseek");
let evidenceSources: typeof import("@/engine/evidence_sources");
let approveRoute: typeof import("@/app/api/runs/[id]/artifacts/[artifactId]/approve/route");
let editRoute: typeof import("@/app/api/runs/[id]/artifacts/[artifactId]/route");
let reportRoute: typeof import("@/app/api/runs/[id]/report.md/route");
let workItemRoute: typeof import("@/app/api/runs/[id]/work-items/[itemId]/route");
let evaluationRoute: typeof import("@/app/api/runs/[id]/evaluation/route");

beforeAll(async () => {
  db = await import("@/adapters/db");
  instanceGraph = await import("@/engine/instance_graph");
  actionExecutor = await import("@/engine/action_executor");
  ontologyTools = await import("@/engine/ontology_tools");
  ontologyAdapter = await import("@/adapters/ontology");
  publish = await import("@/adapters/publish_package");
  workflow = await import("@/engine/workflow");
  deepseek = await import("@/adapters/deepseek");
  evidenceSources = await import("@/engine/evidence_sources");
  approveRoute = await import("@/app/api/runs/[id]/artifacts/[artifactId]/approve/route");
  editRoute = await import("@/app/api/runs/[id]/artifacts/[artifactId]/route");
  reportRoute = await import("@/app/api/runs/[id]/report.md/route");
  workItemRoute = await import("@/app/api/runs/[id]/work-items/[itemId]/route");
  evaluationRoute = await import("@/app/api/runs/[id]/evaluation/route");
});

describe("v1.3 operational spine", () => {
  it("keeps off-topic search candidates out of the evidence boundary", () => {
    expect(deepseek.searchResultIsRelevant(
      "2026 DRAM NAND inventory pricing cycle",
      { title: "Lionel Messi career statistics", summary: "Football records updated in 2026" },
    )).toBe(false);
    expect(deepseek.searchResultIsRelevant(
      "2026 DRAM NAND inventory pricing cycle",
      { title: "Micron DRAM and NAND pricing update", summary: "Memory inventory conditions" },
    )).toBe(true);

    const run = db.createRun("来源边界测试", "semiconductor");
    const bound = db.upsertSource(run.id, {
      url: "https://example.com/bound-source", title: "Bound", publisher: "Example", published_at: null,
      source_type: "disclosure", source_tier: "S2", search_excerpt: "", locator: "quote:bound", captured_at: new Date().toISOString(),
      content_hash: "a".repeat(64), usability_status: "usable", failure_category: "", failure_detail: "",
      final_url: "https://example.com/bound-source", content_mime: "text/html", http_status: 200,
      retrieval_status: "captured", snapshot_text: "bound ".repeat(50), source_quote: "bound", quote_verified: true,
    });
    const candidate = db.upsertSource(run.id, {
      url: "https://example.org/noisy-hit", title: "Noisy", publisher: "", published_at: null,
      source_type: "web_citation", source_tier: "S8", search_excerpt: "", locator: "https://example.org/noisy-hit",
      captured_at: new Date().toISOString(), content_hash: "b".repeat(64), usability_status: "limited",
      failure_category: "", failure_detail: "candidate", final_url: "https://example.org/noisy-hit",
      content_mime: "text/html", http_status: 200, retrieval_status: "limited", snapshot_text: "", source_quote: "", quote_verified: false,
    });
    const evidence = { evidence_drafts: [{ id: "EV-BOUND", kind: "fact_draft", source_ids: [bound.id] }] };
    expect(evidenceSources.evidenceBoundSources(db.listSources(run.id), evidence).map((source) => source.id)).toEqual([bound.id]);
    expect(db.quarantineUnboundWebCitations(run.id, evidenceSources.evidenceBoundSourceIds(evidence))).toBe(1);
    expect(db.listSources(run.id).find((source) => source.id === candidate.id)?.usability_status).toBe("rejected");
  });

  it("classifies model timeouts honestly and prevents duplicate live generations", async () => {
    expect(workflow.classifyRuntimeFailure(new Error("MODEL_TIMEOUT: DeepSeek 超时"))).toBe("model_output_error");
    const run = db.createRun("生成租约测试", "semiconductor");
    const running = db.createArtifact(run.id, "stage_01", { status: "running" });
    await expect(workflow.generateArtifact(run.id, "stage_01")).rejects.toThrow(/已有生成请求运行中/);
    expect(db.getArtifact(running.id)?.status).toBe("running");
    expect(db.listArtifacts(run.id).filter((artifact) => artifact.kind === "stage_01")).toHaveLength(1);
  });

  it("compacts model context to structured authority without losing nested fields", () => {
    expect(workflow.compactStructuredArtifact({
      document_markdown: "# duplicated prose",
      nested: { document_markdown: "duplicate", id: "JU-1" },
      items: [{ document_markdown: "duplicate", statement: "kept" }],
    })).toEqual({ nested: { id: "JU-1" }, items: [{ statement: "kept" }] });
  });

  it("requires auditable human resolutions and cannot disguise a gap as supplemented evidence", async () => {
    const run = db.createRun("工作项人工决策测试", "semiconductor");
    const artifact = db.createArtifact(run.id, "stage_03", { status: "needs_review" });
    const item = db.upsertWorkItem({
      run_id: run.id, kind: "supplement_evidence", stage: "stage_03", target_type: "EvidenceDraft", target_id: "EV-GAP",
      title: "接受或补齐缺口", priority: "high", reason: "来源取得失败", source_event_id: null,
      artifact_id: artifact.id, attempt: artifact.version, payload_json: JSON.stringify({ kind: "gap" }),
    });
    const noAudit = await workItemRoute.PATCH(new Request("http://local", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }),
    }), { params: Promise.resolve({ id: run.id, itemId: item.id }) });
    expect(noAudit.status).toBe(400);
    const disguised = await workItemRoute.PATCH(new Request("http://local", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", note: "已核对当前仍无有效公开来源", resolution: "evidence_supplemented" }),
    }), { params: Promise.resolve({ id: run.id, itemId: item.id }) });
    expect(disguised.status).toBe(400);
    const accepted = await workItemRoute.PATCH(new Request("http://local", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", note: "已确认来源取得失败，结论维持 J0", resolution: "accepted_evidence_gap" }),
    }), { params: Promise.resolve({ id: run.id, itemId: item.id }) });
    expect(accepted.status).toBe(200);
  });

  it("enforces run ownership on artifact mutation and downloads only approved reports", async () => {
    const owner = db.createRun("产物所有权测试", "semiconductor");
    const other = db.createRun("越权路径测试", "semiconductor");
    const artifact = db.createArtifact(owner.id, "stage_01", { status: "needs_review", json_content: "{}" });
    const deniedApproval = await approveRoute.POST(new Request("http://local"), {
      params: Promise.resolve({ id: other.id, artifactId: artifact.id }),
    });
    expect(deniedApproval.status).toBe(404);
    const deniedEdit = await editRoute.PATCH(new Request("http://local", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ json_content: "{}", markdown_content: "x" }),
    }), { params: Promise.resolve({ id: other.id, artifactId: artifact.id }) });
    expect(deniedEdit.status).toBe(404);

    db.createArtifact(owner.id, "stage_05", { status: "needs_review", markdown_content: "draft" });
    const draftDownload = await reportRoute.GET(new Request("http://local"), { params: Promise.resolve({ id: owner.id }) });
    expect(draftDownload.status).toBe(404);
    db.createArtifact(owner.id, "stage_05", { status: "approved", markdown_content: "approved" });
    const approvedDownload = await reportRoute.GET(new Request("http://local"), { params: Promise.resolve({ id: owner.id }) });
    expect(approvedDownload.status).toBe(200);
    expect(await approvedDownload.text()).toBe("approved");
  });

  it("separates formal ontology nodes from runtime operations", () => {
    const nodes = ontologyAdapter.loadOntology();
    expect(nodes.some((node) => node.category === "Action" || node.category === "Function" || node.category === "Logic")).toBe(false);
    expect(nodes.some((node) => node.id === "MarketExpectation" && node.category === "Object")).toBe(true);
    const actions = actionExecutor.listActionTypes();
    expect(actions.every((action) => action.source_file === "runtime/engine/runtime_operations.yaml")).toBe(true);
    expect(actions.every((action) => !("rule_refs" in action))).toBe(true);
    expect(actions.every((action) => Array.isArray(action.formal_rule_refs))).toBe(true);
    expect(actions.every((action) => Array.isArray(action.method_refs))).toBe(true);
    expect(actions.every((action) => Array.isArray(action.governance_rule_refs))).toBe(true);
    expect(actions.every((action) => Array.isArray(action.runtime_rule_refs))).toBe(true);
  });

  it("does not silently treat draft projection as formal authority", () => {
    const run = db.createRun("双轨测试", "semiconductor");
    db.createArtifact(run.id, "stage_02", {
      status: "needs_review",
      json_content: JSON.stringify({
        method_applications: [{
          application_id: "MA-X",
          method_id: "kb02:framework-test",
          method_version: "1.0.0",
          capability_type: "judgment_structure",
          target_question_refs: ["Q-X"],
          target_judgment_unit_refs: ["JU-X"],
          target_ontology_object_refs: [],
          status: "candidate",
          precondition_checks: [],
          input_evidence_refs: [],
          output_signal_refs: [],
          output_judgment_refs: [],
          execution_summary: "",
          applicability_boundary: "测试判断结构",
          limitations: [],
          counter_example_refs: [],
          provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
          alternatives: [],
        }],
        judgment_units: [{ id: "JU-X", title: "t", question: "q", ontology_node_ids: [], evidence_requirements: [] }],
        variables: [],
        paths: [],
        counter_evidence_directions: [],
        competing_explanations: [],
        document_markdown: "x".repeat(50),
      }),
    });
    const loaded = instanceGraph.loadGraphForRun(run.id);
    expect(loaded.authority).toBe("empty");
    const provisional = instanceGraph.buildProvisionalProjection(run.id);
    expect(provisional.authority).toBe("workbench_provisional");
    expect(provisional.objects.some((o) => o.id === "JU-X")).toBe(true);
  });

  it("rejects retired relations and invalid endpoints, then computes reachable stale closure", () => {
    const graph = instanceGraph.emptyGraph();
    graph.objects.push(
      { id: "EV-1", type: "EvidenceFact", properties: {} },
      { id: "SIG-1", type: "Signal", properties: {} },
      { id: "H-1", type: "Hypothesis", properties: {} },
      { id: "J-1", type: "Judgment", properties: {} },
    );
    graph.relations.push(
      { id: "R-1", type: "signalGroundedByFact", sourceId: "SIG-1", targetId: "EV-1", properties: { role: "support" } },
      { id: "R-2", type: "signalEvaluatesHypothesis", sourceId: "SIG-1", targetId: "H-1", properties: { result: "support" } },
      { id: "R-3", type: "judgmentBasedOnHypothesis", sourceId: "J-1", targetId: "H-1", properties: {} },
    );
    const closure = instanceGraph.markReachableDownstreamStale(graph, ["EV-1"]);
    expect(closure.stale_object_ids).toEqual(expect.arrayContaining(["EV-1", "SIG-1", "H-1", "J-1"]));
    expect(closure.graph.objects.find((object) => object.id === "J-1")?.properties?.validity_status).toBe("stale");
    const invalid = structuredClone(graph);
    invalid.objects = [
      { id: "SD-1", type: "SourceDocument", properties: { title: "source", uri: "https://example.com", published_at: "2026-07-18T00:00:00Z", source_tier: "S2" } },
      { id: "CL-1", type: "EvidenceClaim", properties: { statement: "claim", locator: "p1", extracted_at: "2026-07-18T01:00:00Z", cutoff_at: "2026-07-18T02:00:00Z" } },
    ];
    invalid.relations = [{ id: "R-INVALID", type: "signalDerivedFromEvidence", sourceId: "CL-1", targetId: "SD-1", properties: {} }];
    expect(() => db.saveInstanceGraph(runForGraphTest(), { business_instance_graph: invalid })).toThrow(/已退役关系/);
  });

  it("runs RegisterSource → ExtractClaim → AssessEvidenceForUse spine", () => {
    let graph = instanceGraph.emptyGraph();
    const source = actionExecutor.executeAction(
      "RegisterSource",
      {
        title: "测试来源", url: "https://example.com/a", locator: "quote:价格上行", sourceTier: "S2",
        publishedAt: "2026-07-18T00:00:00Z", capturedAt: "2026-07-18T01:00:00Z", publisher: "Example",
        contentHash: "a".repeat(64), sourceGroup: "example.com", retrievalStatus: "captured", usabilityStatus: "usable",
        sourceQuote: "价格上行", quoteVerified: true,
      },
      graph,
    );
    expect(source.status).toBe("executed");
    expect(source.function_result).toMatchObject({
      reliability: "high",
      reliabilityBasis: { traceabilityVerified: true },
    });
    expect(source.audit).toMatchObject({
      formal_rule_refs: [],
      method_refs: ["kb03:acquisition"],
      governance_rule_refs: ["GOV-SOURCE-TRACE-001", "GOV-SOURCE-ACCESS-001"],
      runtime_rule_refs: ["RT-OPERATION-REGISTRY-001"],
    });
    graph = source.graph;
    const claim = actionExecutor.executeAction(
      "ExtractClaim",
      { sourceRef: source.written_object_ids[0], statement: "价格上行", locator: "para-1", cutoffAt: "2026-07-18T02:00:00Z" },
      graph,
    );
    expect(claim.status).toBe("executed");
    graph = claim.graph;
    const normalized = actionExecutor.executeAction(
      "NormalizeClaim",
      { claimRef: claim.written_object_ids[0], semanticRefs: [], unit: "CNY/GB", businessTime: "2026Q3" },
      graph,
    );
    expect(normalized.status).toBe("executed");
    expect(normalized.graph.objects.find((object) => object.id === claim.written_object_ids[0])?.properties?.normalized).toBe(true);
    graph = normalized.graph;
    const assess = actionExecutor.executeAction(
      "AssessEvidenceForUse",
      { evidenceRefs: claim.written_object_ids, assessmentScope: "test", directness: "direct", limitations: [] },
      graph,
    );
    expect(assess.status).toBe("executed");
    expect(assess.graph.objects.some((o) => o.type === "EvidenceAssessment")).toBe(true);
    expect(assess.function_result).toMatchObject({ usability: "usable", qualityLevel: "medium" });
  });

  it("forms hypothesis and judgment then records reasoning trace", () => {
    let graph = instanceGraph.emptyGraph();
    graph.objects.push(
      { id: "SCOPE-1", type: "ResearchScope", properties: { label: "价格研究范围", dimensions: { domain: "semiconductor" } } },
      { id: "JU-1", type: "JudgmentUnit", properties: { statement: "价格是否上行", judgment_type: "trend_direction", scope_ref: "SCOPE-1" } },
      { id: "SV-1", type: "StateVariable", properties: { name: "price", category: "market", definition: "可比口径价格", variable_kind: "observed", anchors: ["price"] } },
    );
    graph.relations.push({ id: "REL-JU-SCOPE", type: "unitUsesScope", sourceId: "JU-1", targetId: "SCOPE-1", properties: {} });
    const hyp = actionExecutor.executeAction(
      "FormHypothesis",
      { statement: "价格将继续上行", variableRef: "SV-1", judgmentUnitRef: "JU-1", falsificationConditions: ["合约价回落"], timeHorizon: "未来一季度", direction: "up" },
      graph,
    );
    expect(hyp.status).toBe("executed");
    graph = hyp.graph;
    graph.objects.push(
      { id: "SD-1", type: "SourceDocument", properties: { title: "公告", uri: "https://example.com/a", published_at: "2026-07-18T00:00:00Z", source_tier: "S2", source_group: "example.com" } },
      { id: "CL-1", type: "EvidenceClaim", properties: { statement: "价格上行", locator: "p1", extracted_at: "2026-07-18T01:00:00Z", cutoff_at: "2026-07-18T02:00:00Z" } },
      { id: "EV-1", type: "EvidenceFact", properties: { statement: "可比价格上行", subject_ref: "SV-1", time_basis: "publication_time", scope_ref: "SCOPE-1", observed_at: "2026-07-17T00:00:00Z", valid_from: "2026-07-17T00:00:00Z", published_at: "2026-07-18T00:00:00Z", cutoff_at: "2026-07-18T02:00:00Z", directness: "direct" } },
      { id: "SIG-1", type: "Signal", properties: { statement: "价格上行支持假设", role: "support" } },
      { id: "MA-TEST", type: "MethodApplication", properties: { application_id: "MA-TEST", status: "executed", method_id: "kb04:A02", method_version: "1.0.0" } },
      ...["evidence_scope_time_alignment", "no_direct_evidence_to_judgment", "judgment_reference_integrity", "judgment_evidence_threshold", "judgment_status_consistency"].map((rule, index) => ({ id: `RE-${index + 1}`, type: "RuleEvaluation", properties: { rule_ref: rule, input_refs: ["EV-1"], condition_results: [{ condition_id: "runtime", outcome: "pass" }], result: "pass", deterministic_result: { engine_version: "runtime-semantic-rules-2.0.0", result: "pass" } } })),
    );
    graph.relations.push(
      { id: "REL-CL-SD", type: "claimCitesSource", sourceId: "CL-1", targetId: "SD-1", properties: {} },
      { id: "REL-EV-CL", type: "factDerivedFromClaim", sourceId: "EV-1", targetId: "CL-1", properties: {} },
      { id: "REL-SIG-EV", type: "signalGroundedByFact", sourceId: "SIG-1", targetId: "EV-1", properties: { role: "support" } },
      { id: "REL-SIG-H", type: "signalEvaluatesHypothesis", sourceId: "SIG-1", targetId: hyp.written_object_ids[0], properties: {} },
      { id: "REL-MA-JU", type: "runtimeMethodApplicationTargets", sourceId: "MA-TEST", targetId: "JU-1", properties: {} },
    );
    const judgment = actionExecutor.executeAction(
      "FormJudgment",
      {
        statement: "价格存在有条件上行趋势", hypothesisRefs: hyp.written_object_ids, signalRefs: ["SIG-1"], evidenceRefs: ["EV-1"],
        ruleEvaluationRefs: ["RE-1", "RE-2", "RE-3", "RE-4", "RE-5"], methodApplicationRefs: ["MA-TEST"],
        judgmentUnitRef: "JU-1", scopeRef: "SCOPE-1", cutoffAt: "2026-07-18T02:00:00Z", judgmentLevel: "J1",
        decisionStatus: "supported", conflictStatus: "none", conditions: ["口径可比"], invalidationConditions: ["价格回落"],
      },
      graph,
    );
    expect(judgment.status).toBe("executed");
    graph = judgment.graph;
    const trace = actionExecutor.executeAction(
      "RecordReasoningTrace",
      {
        judgmentRef: judgment.written_object_ids[0],
        inputRefs: ["SCOPE-1", "JU-1", "EV-1", "SIG-1", hyp.written_object_ids[0], "RE-1", "RE-2", "RE-3", "RE-4", "RE-5"],
        methodApplicationRefs: ["MA-TEST"], evaluatedAt: "2026-07-18T02:00:00Z",
      },
      graph,
    );
    expect(trace.status).toBe("executed");
    expect(trace.graph.objects.some((o) => o.type === "ReasoningTrace")).toBe(true);

    const incompleteTrace = actionExecutor.executeAction(
      "RecordReasoningTrace",
      {
        judgmentRef: judgment.written_object_ids[0],
        inputRefs: ["SCOPE-1", "JU-1", hyp.written_object_ids[0], "RE-1", "RE-2", "RE-3", "RE-4", "RE-5"],
        methodApplicationRefs: ["MA-TEST"], evaluatedAt: "2026-07-18T02:00:00Z",
      },
      graph,
    );
    expect(incompleteTrace).toMatchObject({ status: "rejected" });
    expect(incompleteTrace.rejected_reason).toMatch(/缺少判断依赖节点/);
  });

  it("exports workbench package and invokes validate_workbench_package bridge", async () => {
    const run = db.createRun("发布桥测试", "semiconductor");
    const cutoff = "2026-07-18T08:00:00Z";
    const baseMa = {
      application_id: "MA-PUBLISH", method_id: "kb04:A01", method_version: "1.0.0", capability_type: "adjudication" as const,
      target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: ["SV-INV"],
      status: "candidate" as const, precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [],
      execution_summary: "", applicability_boundary: "状态判断", limitations: [], counter_example_refs: [],
      provenance: { stage: "stage_02" as const, source_application_id: null, actor: "test", recorded_at: null }, alternatives: [],
    };
    const stage01 = { normalized_question: "测试可发布研究", core_object: "库存", judgment_action: "状态判断", time_scope: { lookback: "一年", as_of: cutoff, forward: "一季度" }, boundaries: ["半导体"], exclusions: ["交易建议"], report_type: "行业判断", domain_supported: true, document_markdown: "# 任务\n\n围绕库存是否下降形成可证伪研究任务，冻结研究对象、截止时间、观察区间和不包含交易建议的表达边界。" };
    const stage02 = {
      method_applications: [baseMa], research_scope: { id: "SCOPE-1", label: "半导体库存范围", dimensions: { domain: "semiconductor" } },
      judgment_units: [{ id: "JU-1", title: "库存", question: "库存是否下降", judgment_type: "state_measurement", scope_ref: "SCOPE-1", ontology_node_ids: ["SV-INV"], evidence_requirements: ["需要可定位库存事实"] }],
      variables: [{ id: "SV-INV", name: "inventory", category: "operations", definition: "可比口径库存", variable_kind: "observed", anchors: ["inventory"], ontology_node_id: "StateVariable", role: "target" }],
      paths: [{ id: "PATH-1", statement: "库存变化形成状态信号", variable_ids: ["SV-INV"] }], counter_evidence_directions: ["库存回升"], competing_explanations: ["季节性波动"], document_markdown: "# 结构\n\n建立单一原子判断单元、冻结范围、状态变量、可证伪路径、反证方向和竞争解释，并绑定候选方法应用。",
    };
    const source = db.upsertSource(run.id, {
      url: "https://example.com/publish-source", title: "可验证来源", publisher: "Example", published_at: "2026-07-18",
      source_type: "disclosure", source_tier: "S2", source_group: "example.com", search_excerpt: "库存下降", locator: "quote:库存下降", captured_at: cutoff,
      content_hash: "a".repeat(64), usability_status: "usable", failure_category: "", failure_detail: "",
      final_url: "https://example.com/publish-source", content_mime: "text/html", http_status: 200, retrieval_status: "captured",
      snapshot_text: "库存下降", source_quote: "库存下降", quote_verified: true,
    });
    const selected = { ...baseMa, status: "selected" as const, provenance: { ...baseMa.provenance, stage: "stage_03" as const, source_application_id: "MA-PUBLISH" }, precondition_checks: [{ precondition_id: "state_variable_defined", result: "pass" as const, evidence_refs: ["EV-1"], reason: "ok" }, { precondition_id: "observation_scope_aligned", result: "pass" as const, evidence_refs: ["EV-1"], reason: "ok" }], input_evidence_refs: ["EV-1"] };
    const sourceDraft = { source_id: source.id, source_key: "SRC-1", url: source.url, title: source.title, publisher: source.publisher, published_at: "2026-07-18T00:00:00Z", source_tier: "S2", source_type: "disclosure", search_excerpt: "库存下降", locator: "quote:库存下降", source_quote: "库存下降", captured_at: cutoff, content_hash: "a".repeat(64), final_url: source.url, retrieval_status: "captured", quote_verified: true };
    const stage03 = { method_applications: [selected], sources: [sourceDraft], evidence_drafts: [{ id: "EV-1", statement: "可比口径库存下降", kind: "fact_draft", direction: "support", source_keys: ["SRC-1"], source_ids: [source.id], judgment_unit_ids: ["JU-1"], ontology_node_ids: ["SV-INV"], subject_ref: "SV-INV", time_basis: "observation_time", scope_ref: "SCOPE-1", observed_at: "2026-07-17T00:00:00Z", valid_from: "2026-07-17T00:00:00Z", valid_to: null, published_at: "2026-07-18T00:00:00Z", cutoff_at: cutoff, directness: "direct", limitations: [] }], unresolved_gaps: [], document_markdown: "# 证据\n\n正文已抓取并完成事实级定位、来源哈希冻结、发布时间核验、范围与观察时间对齐；该事实已绑定取证方法和原子判断单元。" };
    const executed = { ...selected, status: "executed" as const, provenance: { ...selected.provenance, stage: "stage_04" as const, recorded_at: cutoff }, output_signal_refs: ["SIG-1"], output_judgment_refs: ["J-1"], execution_summary: "完成有边界状态裁决" };
    const ruleNames = ["evidence_scope_time_alignment", "no_direct_evidence_to_judgment", "judgment_reference_integrity", "judgment_evidence_threshold", "judgment_status_consistency"];
    const rules = ruleNames.map((rule_ref, index) => ({ id: `RE-${index + 1}`, rule_ref, judgment_id: "J-1", input_refs: ["EV-1"], condition_results: [{ condition_id: "runtime", expression: "verified", input_refs: ["EV-1"], outcome: "pass", rationale: "verified" }], result: "pass", deterministic_result: { engine_version: "runtime-semantic-rules-2.0.0", result: "pass", rationale: "verified", evaluated_at: cutoff } }));
    const stage04 = { method_applications: [executed], signals: [{ id: "SIG-1", statement: "库存下降构成支持信号", role: "support", evidence_draft_ids: ["EV-1"], judgment_unit_ids: ["JU-1"], target_hypothesis_ids: ["H-1"] }], hypotheses: [{ id: "H-1", statement: "库存处于下降阶段", signal_ids: ["SIG-1"], falsification_conditions: ["库存回升"], time_horizon: "一季度" }], competing_explanations: [{ id: "CE-1", statement: "季节性波动", signal_ids: ["SIG-1"], discriminating_evidence: ["跨季对照"], status: "weakened", elimination_rationale: "部分削弱" }], rule_evaluations: rules, judgments: [{ id: "J-1", judgment_unit_id: "JU-1", title: "库存观察", conclusion: "库存存在下降迹象", rationale: "一组直接来源仅支持 J1", strength: "J1", confidence: "low", decision_status: "supported", conflict_status: "none", not_judgeable_reason: null, scope_ref: "SCOPE-1", cutoff_at: cutoff, conditions: [], supporting_evidence_draft_ids: ["EV-1"], counter_evidence_draft_ids: [], hypothesis_ids: ["H-1"], rule_evaluation_ids: rules.map((rule) => rule.id), method_application_ids: ["MA-PUBLISH"], ontology_node_ids: ["SV-INV"], uncertainties: ["样本短"], invalidation_conditions: ["库存回升"], tracking_signals: ["库存"] }], reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["SCOPE-1", "JU-1", "EV-1", "SIG-1", "H-1", ...rules.map((rule) => rule.id), "MA-PUBLISH", "J-1"], created_at: cutoff }], overall_boundary: "仅限本范围", document_markdown: "# 判断\n\n当前只有一组直接来源，确定性规则将证据上限限制在 J1；保留季节性竞争解释和库存回升失效条件，不外推为确定趋势。" };
    const stage05 = { title: "测试报告", executive_points: ["库存存在下降迹象"], report_claims: [{ id: "EX-1", statement: "库存存在下降迹象", judgment_ids: ["J-1"], method_application_ids: ["MA-PUBLISH"], evidence_draft_ids: ["EV-1"], source_ids: [source.id] }], limitations: ["仅一组直接来源"], document_markdown: "# 测试报告\n\n库存存在下降迹象，但当前仅一组直接来源，因此结论保持在 J1 观察层。" };
    const addApproved = (kind: "stage_01"|"stage_02"|"stage_03"|"stage_04"|"stage_05", data: object, model = "producer-model") => {
      const draft = db.createArtifact(run.id, kind, { status: "needs_review", json_content: JSON.stringify(data), markdown_content: (data as any).document_markdown || "", model_name: model });
      const targets = kind === "stage_03" ? (data as any).evidence_drafts || [] : kind === "stage_04" ? (data as any).judgments || [] : [];
      for (const target of targets) {
        const item = db.upsertWorkItem({
          run_id: run.id,
          kind: kind === "stage_03" ? "evidence_review" : "judgment_review",
          stage: kind,
          target_type: kind === "stage_03" ? "EvidenceDraft" : "Judgment",
          target_id: target.id,
          title: `确认 ${target.id}`,
          priority: "high",
          reason: "生产路径测试人工批准",
          source_event_id: null,
          artifact_id: draft.id,
          attempt: draft.version,
          payload_json: "{}",
        });
        db.updateWorkItem(item.id, { status: "approved", note: "测试研究员确认" });
      }
      workflow.approve(draft.id);
      return db.getArtifact(draft.id)!;
    };
    addApproved("stage_01", stage01); addApproved("stage_02", stage02); const evidenceArtifact = addApproved("stage_03", stage03); const judgmentArtifact = addApproved("stage_04", stage04); const reportArtifact = addApproved("stage_05", stage05);
    let graph = instanceGraph.emptyGraph(); graph = instanceGraph.materializeStageIntoGraph(graph, "stage_02", stage02); graph = instanceGraph.materializeStageIntoGraph(graph, "stage_03", stage03); graph = instanceGraph.materializeStageIntoGraph(graph, "stage_04", stage04); db.saveInstanceGraph(run.id, { business_instance_graph: graph });
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const baselineData = { frozen_stage03_artifact_id: evidenceArtifact.id, frozen_stage03_artifact_hash: hash(evidenceArtifact.json_content), title: "同证据基线", core_claims: [{ id: "B-1", statement: "库存下降", source_keys: ["SRC-1"] }], counterpoints: ["可能是季节性"], limitations: ["样本有限"], sources: [sourceDraft], document_markdown: "# 同证据基线\n\n库存下降，但可能存在季节性影响。" };
    const baseline = db.createArtifact(run.id, "baseline", { status: "approved", json_content: JSON.stringify(baselineData), markdown_content: baselineData.document_markdown, model_name: "baseline-model", approved_at: cutoff });
    const reviewData = { reviewed_stage04_artifact_id: judgmentArtifact.id, reviewed_stage04_artifact_hash: hash(judgmentArtifact.json_content), verdict: "pass", issues: [], strengths: ["边界明确"], overall_assessment: "通过", document_markdown: "# 独立审阅\n\n证据、方法和判断边界一致。", reviewer_model: "reviewer-model", producer_model: "producer-model", independence_level: "independent_model" };
    db.createArtifact(run.id, "independent_review", { status: "approved", json_content: JSON.stringify(reviewData), markdown_content: reviewData.document_markdown, model_name: "reviewer-model", approved_at: cutoff });
    const criteria = ["事实与来源可核验性", "无来源主张控制", "反证与竞争解释", "结论边界", "可复盘性", "研究决策帮助"];
    db.createArtifact(run.id, "evaluation", { status: "approved", json_content: JSON.stringify({ scores: Object.fromEntries(criteria.flatMap((criterion) => [[`A:${criterion}`, 4], [`B:${criterion}`, 4]])), metrics: {}, notes: "已完成同证据盲评核对", evaluator: "test-researcher", evaluated_at: cutoff, revealed: true, side_a: "baseline", baseline_artifact_id: baseline.id, runtime_report_artifact_id: reportArtifact.id, frozen_stage03_artifact_id: evidenceArtifact.id, frozen_stage03_artifact_hash: hash(evidenceArtifact.json_content) }), approved_at: cutoff });
    const rescore = await evaluationRoute.POST(new Request("http://local", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scores: Object.fromEntries(criteria.flatMap((criterion) => [[`A:${criterion}`, 5], [`B:${criterion}`, 1]])), notes: "已揭示后尝试重评应被拒绝", evaluator: "test-researcher" }),
    }), { params: Promise.resolve({ id: run.id }) });
    expect(rescore.status).toBe(400);
    expect(await rescore.json()).toMatchObject({ error: expect.stringMatching(/不得重评/) });
    const result = publish.publishAndValidate(run.id);
    expect(result.export_rel).toContain(run.id);
    expect(result.validation_summary.package_kind).toBe("workbench_export");
    expect(result.validate_ok).toBe(true);
    expect(result.validation_summary.publish_status).toBe("workbench_validate_passed");
    const updated = db.getRun(run.id)!;
    expect(updated.manifest_json).toContain("workbench_validate_");

    const spoofedEvidence = db.createArtifact(run.id, "stage_03", {
      status: "needs_review",
      json_content: JSON.stringify({
        ...stage03,
        sources: [{ ...sourceDraft, content_hash: "f".repeat(64) }],
        document_markdown: "# 伪造来源测试\n\n该产物故意篡改正文哈希，但保留其余完整字段，用于证明确认流程会和 Source Registry 逐字段核对并拒绝伪造绑定。",
      }),
      markdown_content: stage03.document_markdown,
    });
    expect(() => workflow.approve(spoofedEvidence.id)).toThrow(/Source Registry 不一致/);

    const untracedExpression = db.createArtifact(run.id, "stage_05", {
      status: "needs_review",
      json_content: JSON.stringify({
        ...stage05,
        report_claims: [{ ...stage05.report_claims[0], evidence_draft_ids: [] }],
        document_markdown: "# 追溯缺失测试\n\n该表达故意删除事实级 evidence_draft_ids，同时保留来源 ID，用于证明阶段 05 不能绕过 Judgment 的事实路径直接挑选来源。",
      }),
      markdown_content: stage05.document_markdown,
    });
    expect(() => workflow.approve(untracedExpression.id)).toThrow(/缺少事实级 evidence_draft_ids/);
    const unreviewedJudgment = db.createArtifact(run.id, "stage_04", {
      status: "needs_review",
      json_content: JSON.stringify(stage04),
      markdown_content: stage04.document_markdown,
      model_name: "producer-model",
    });
    expect(() => workflow.approve(unreviewedJudgment.id)).toThrow(/未创建审阅工作项/);
    const republished = publish.publishAndValidate(run.id);
    expect(republished.validate_ok).toBe(true);
    expect(republished.validation_summary.publish_status).toBe("workbench_validate_passed");
  });

  it("blocks publish before report, independent review and object work are cleared", () => {
    const run = db.createRun("发布阻断测试", "semiconductor");
    expect(() => publish.publishAndValidate(run.id)).toThrow(/阶段 05 尚未确认/);
  });

  it("queries package-bound object set", () => {
    const run = db.createRun("对象集测试", "semiconductor", "instances/02_V3样例/01_memory-cycle-run-002");
    const set = ontologyTools.runOntologyTool(run.id, "query_object_set", { type: "JudgmentUnit", limit: 5 });
    expect((set as any).objects.length).toBeGreaterThan(0);
  });
});

function runForGraphTest() {
  return db.createRun(`graph-contract-${crypto.randomUUID()}`, "semiconductor").id;
}
