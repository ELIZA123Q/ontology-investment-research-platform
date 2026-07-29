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
let semanticExecution: typeof import("@/engine/semantic_execution");
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
  semanticExecution = await import("@/engine/semantic_execution");
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
    expect(deepseek.searchResultIsRelevant(
      "site:trendforce.com DRAM contract price inventory 2026",
      {
        title: "Dynamic random-access memory",
        summary: "DRAM inventory",
        url: "https://en.wikipedia.org/wiki/Dynamic_random-access_memory",
      },
    )).toBe(false);
    expect(deepseek.searchResultIsRelevant(
      "site:trendforce.com DRAM contract price inventory 2026",
      {
        title: "DRAM Contract Price",
        summary: "DRAM inventory and contract pricing",
        url: "https://www.trendforce.com/price/dram/dram_contract",
      },
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

  it("parses DuckDuckGo HTML fallback into canonical public result URLs", () => {
    const html = `
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a"
              href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.samsung.com%2Fglobal%2Fsamsung%2Dships%2Dhbm4&amp;rut=abc">
              Samsung Ships Industry-First Commercial <b>HBM4</b>
            </a>
          </h2>
          <span>&nbsp; &nbsp; 2026-02-12T00:00:00.0000000</span>
          <a class="result__snippet" href="#">Samsung began <b>mass production</b> &amp; commercial shipments.</a>
          <div class="clear"></div>
        </div>
      </div>`;
    expect(deepseek.parseDuckDuckGoHtml(html)).toEqual([{
      title: "Samsung Ships Industry-First Commercial HBM4",
      url: "https://news.samsung.com/global/samsung-ships-hbm4",
      summary: "Samsung began mass production & commercial shipments.",
      published_at: "2026-02-12T00:00:00.0000000",
    }]);
  });

  it("parses Brave HTML fallback when anonymous DuckDuckGo search is challenged", () => {
    const html = `
      <div class="snippet" data-pos="0" data-type="web">
        <div class="result-content">
          <a href="https://news.samsung.com/global/samsung-ships-hbm4"
             target="_self" class="result-link l1">
            <div class="site-name-wrapper">news.samsung.com</div>
            <div class="title search-snippet-title" title="Samsung Ships Commercial HBM4">
              Samsung Ships Commercial HBM4
            </div>
          </a>
          <div class="generic-snippet">
            <div class="content desktop-default-regular">
              <span>February 13, 2026 -</span>
              Samsung began <strong>mass production</strong> &amp; shipments.
            </div>
          </div>
        </div>
      </div>`;
    expect(deepseek.parseBraveHtml(html)).toEqual([{
      title: "Samsung Ships Commercial HBM4",
      url: "https://news.samsung.com/global/samsung-ships-hbm4",
      summary: "February 13, 2026 - Samsung began mass production & shipments.",
      published_at: "February 13, 2026",
    }]);
  });

  it("classifies model timeouts honestly and prevents duplicate live generations", async () => {
    expect(workflow.classifyRuntimeFailure(new Error("MODEL_TIMEOUT: DeepSeek 超时"))).toBe("model_output_error");
    const run = db.createRun("生成租约测试", "semiconductor");
    const running = db.createArtifact(run.id, "stage_01", { status: "running" });
    await expect(workflow.generateArtifact(run.id, "stage_01")).rejects.toThrow(/已有生成请求运行中/);
    expect(db.getArtifact(running.id)?.status).toBe("running");
    expect(db.listArtifacts(run.id).filter((artifact) => artifact.kind === "stage_01")).toHaveLength(1);
  });

  it("prevents an expired generation from resurrecting after lease recovery", () => {
    const run = db.createRun("过期生成不可复活", "semiconductor");
    const artifact = db.createArtifact(run.id, "stage_01", { status: "running" });
    expect(db.updateArtifactIfStatus(artifact.id, "running", {
      status: "failed", error_message: "MODEL_TIMEOUT_RECOVERED",
    })?.status).toBe("failed");
    expect(db.updateArtifactIfStatus(artifact.id, "running", {
      status: "needs_review", json_content: JSON.stringify({ stale: true }),
    })).toBeUndefined();
    expect(db.getArtifact(artifact.id)?.status).toBe("failed");
    expect(db.getArtifact(artifact.id)?.json_content).toBe("{}");
  });

  it("cancels a running generation without deleting its audit attempt", () => {
    const run = db.createRun("取消生成保留审计", "semiconductor");
    const artifact = db.createArtifact(run.id, "stage_01", { status: "running" });
    const cancelled = workflow.cancelGeneration(artifact.id);
    expect(cancelled.status).toBe("failed");
    expect(cancelled.error_message).toMatch(/GENERATION_CANCELLED/);
    expect(db.listArtifacts(run.id).map((item) => item.id)).toContain(artifact.id);
    expect(() => workflow.cancelGeneration(artifact.id)).toThrow(/只有运行中的生成/);
  });

  it("compacts model context to structured authority without losing nested fields", () => {
    expect(workflow.compactStructuredArtifact({
      document_markdown: "# duplicated prose",
      nested: { document_markdown: "duplicate", id: "JU-1" },
      items: [{ document_markdown: "duplicate", statement: "kept" }],
    })).toEqual({ nested: { id: "JU-1" }, items: [{ statement: "kept" }] });
  });

  it("keeps sources out of non-evidence prompts and narrows inherited method definitions", () => {
    const source = { usability_status: "usable" } as any;
    const rejected = { usability_status: "rejected" } as any;
    expect(workflow.sourcesForPrompt("stage_02", [source])).toEqual([]);
    expect(workflow.sourcesForPrompt("stage_03", [source, rejected])).toEqual([source]);
    expect(workflow.sourcesForPrompt("stage_03", [
      source,
      { ...source, id: "SRC-FUTURE", url: "https://future.example.com", normalized_url: "https://future.example.com", published_at: "2026-01-01T00:00:00.000Z" },
    ], "2025-01-16T23:59:59.999Z")).toEqual([source]);
    expect(workflow.sourcesForPrompt("stage_04", [source])).toEqual([]);
    expect(workflow.sourceForFrozenBaseline({ ...source, source_quote: "frozen quote", snapshot_text: "unregistered extra facts" }))
      .toMatchObject({ source_quote: "frozen quote", snapshot_text: "frozen quote" });
    const inherited = [{ json: { method_applications: [{ method_id: "kb03:A02" }, { method_id: "kb04:A01" }] } }];
    expect(workflow.methodCandidatesForPrompt("stage_03", inherited).map((item) => item.method_id).sort())
      .toEqual(["kb03:A02", "kb04:A01"]);
    expect(workflow.methodCandidatesForPrompt("stage_02", []).length).toBeGreaterThan(40);
    const financialCandidates = workflow.methodCandidatesForPrompt(
      "stage_02",
      [],
      "台积电营收是否同比增长，且第四季度增速是否高于全年增速",
    );
    expect(financialCandidates.length).toBeLessThan(20);
    expect(new Set(financialCandidates.map((item) => item.capability_type))).toEqual(
      new Set(["judgment_structure", "evidence", "adjudication"]),
    );
    expect(financialCandidates.map((item) => item.method_id)).toEqual(
      expect.arrayContaining(["BF-FQ-01", "kb03:A02", "kb03:A03", "kb04:A01", "kb04:A02"]),
    );
    expect(workflow.methodCandidatesForPrompt(
      "stage_02",
      [],
      "营收是否增长；排除估值、原因、利润影响和公司对比",
    ).map((item) => item.method_id)).toEqual(expect.arrayContaining(["BF-FQ-01", "kb03:A02", "kb04:A01"]));
  });

  it("rejects cosmetic ontology bindings while allowing explicit task-local variables", () => {
    expect(() => workflow.validateOntologyVariableBindings([
      { id: "V-REVENUE", ontology_node_id: "earnings_elasticity_typo" },
    ])).toThrow(/禁止为满足结构而牵强挂靠本体/);
    expect(() => workflow.validateOntologyVariableBindings([
      { id: "V-REVENUE", ontology_node_id: "task_local:V-REVENUE" },
    ])).not.toThrow();
  });

  it("projects only explicitly bound, cutoff-safe, quote-verified sources into Stage03", () => {
    const run = db.createRun("受控事实投影", "semiconductor");
    const cutoff = "2025-01-16T23:59:59.999+08:00";
    db.createArtifact(run.id, "stage_01", {
      status: "approved",
      json_content: JSON.stringify({ time_scope: { as_of: cutoff } }),
    });
    const baseMa = {
      target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [], status: "candidate",
      precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [], execution_summary: "",
      applicability_boundary: "同口径营收比较", limitations: [], counter_example_refs: [],
      provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null }, alternatives: [],
    } as const;
    const structureMa = { ...baseMa, application_id: "MA-CONTROLLED-STRUCT", method_id: "BF-FQ-01", method_version: "2.0.0", capability_type: "judgment_structure" };
    const evidenceMa = { ...baseMa, application_id: "MA-CONTROLLED-EVIDENCE", method_id: "kb03:A02", method_version: "3.2.0", capability_type: "evidence" };
    const adjudicationMa = { ...baseMa, application_id: "MA-CONTROLLED-ADJ", method_id: "kb04:A02", method_version: "1.0.0", capability_type: "adjudication" };
    db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify({
        method_applications: [structureMa, evidenceMa, adjudicationMa],
        research_scope: { id: "SCOPE-CONTROLLED", label: "同口径营收", dimensions: {} },
        judgment_units: [{ id: "JU-1", title: "营收趋势", question: "营收是否增长", judgment_type: "trend_direction", scope_ref: "SCOPE-CONTROLLED", ontology_node_ids: ["task_local:revenue"], evidence_requirements: ["官方同比披露"] }],
        variables: [{ id: "revenue", name: "revenue", category: "financial", definition: "同口径营收", variable_kind: "observed", anchors: ["官方披露"], ontology_node_id: "task_local:revenue", role: "target" }],
        paths: [], counter_evidence_directions: [], competing_explanations: [], document_markdown: "# 结构\n\n以官方同口径营收披露验证同比方向，并保留来源独立性和截止时间边界。",
      }),
    });
    const quote = "Our net revenue in 2024 increased by 33.9% from 2023.";
    const source = db.upsertSource(run.id, {
      url: "https://www.sec.gov/example", title: "TSMC revenue", publisher: "TSMC", published_at: "2025-01-10T00:00:00.000Z",
      source_type: "filing", source_tier: "S1", search_excerpt: "", locator: "paragraph 1", captured_at: "2025-01-10T01:00:00.000Z",
      content_hash: "c".repeat(64), usability_status: "usable", failure_category: "", failure_detail: "",
      final_url: "https://www.sec.gov/example", content_mime: "text/html", http_status: 200,
      retrieval_status: "captured", snapshot_text: quote, source_quote: quote, quote_verified: true,
    });
    const artifact = workflow.createControlledEvidenceProjection(run.id, [{
      source_id: source.id, judgment_unit_ids: ["JU-1"], subject_ref: "revenue", observed_at: "2024-12-31T00:00:00.000Z",
    }]);
    const data = JSON.parse(artifact.json_content);
    expect(artifact.status).toBe("needs_review");
    expect(data.evidence_drafts[0]).toMatchObject({ statement: quote, source_ids: [source.id], directness: "direct" });
    expect(data.method_applications.find((item: any) => item.capability_type === "evidence")).toMatchObject({ status: "selected", input_evidence_refs: ["EV-CONTROLLED-01"] });
    expect(data.unresolved_gaps[0]).toMatch(/来源独立性不足/);
    expect(() => workflow.createControlledEvidenceProjection(run.id, [
      { source_id: source.id, judgment_unit_ids: ["JU-1"], subject_ref: "revenue", observed_at: "2024-12-31T00:00:00.000Z" },
      { source_id: source.id, judgment_unit_ids: ["JU-1"], subject_ref: "revenue", observed_at: "2024-12-31T00:00:00.000Z" },
    ])).toThrow(/同一来源只能登记一次/);

    db.updateArtifact(artifact.id, { status: "approved" });
    const judgmentArtifact = workflow.createControlledJudgmentProjection(run.id, [{
      judgment_unit_id: "JU-1",
      conclusion: "发行人披露的2024年营收同比增长33.9%，在当前证据边界内形成增长方向观察。",
      evidence_draft_ids: ["EV-CONTROLLED-01"],
      confirmed_precondition_ids: ["state_measurement_or_equivalent_baseline"],
      invalidation_conditions: ["发行人更正该同比增速"],
    }]);
    const judgmentData = JSON.parse(judgmentArtifact.json_content);
    expect(judgmentData.judgments[0]).toMatchObject({ strength: "J1", decision_status: "supported" });
    expect(judgmentData.rule_evaluations.filter((item: any) => item.id.startsWith("RE-SYS-"))).toHaveLength(semanticExecution.REQUIRED_RULES.length);
    expect(judgmentData.rule_evaluations.every((item: any) => item.result === "pass")).toBe(true);
    expect(judgmentData.competing_explanations[0]).toMatchObject({ status: "active" });

    const counterQuote = "Independent channel checks show cautious demand and inventory rebuilding before a policy deadline.";
    const counterSource = db.upsertSource(run.id, {
      url: "https://industry.example/counter", title: "Independent channel check", publisher: "IndustrySurvey", published_at: "2025-01-11T00:00:00.000Z",
      source_type: "industry_survey", source_tier: "S2", source_group: "independent-survey", search_excerpt: "", locator: "paragraph 2", captured_at: "2025-01-11T01:00:00.000Z",
      content_hash: "e".repeat(64), usability_status: "usable", failure_category: "", failure_detail: "",
      final_url: "https://industry.example/counter", content_mime: "text/html", http_status: 200,
      retrieval_status: "captured", snapshot_text: counterQuote.repeat(4), source_quote: counterQuote, quote_verified: true,
    });
    const conflictEvidence = workflow.createControlledEvidenceProjection(run.id, [
      { source_id: source.id, judgment_unit_ids: ["JU-1"], subject_ref: "revenue", observed_at: "2024-12-31T00:00:00.000Z", direction: "support" },
      { source_id: counterSource.id, judgment_unit_ids: ["JU-1"], subject_ref: "channel_demand", observed_at: "2024-12-31T00:00:00.000Z", direction: "weaken" },
    ]);
    db.updateArtifact(conflictEvidence.id, { status: "approved" });
    const contested = workflow.createControlledJudgmentProjection(run.id, [{
      judgment_unit_id: "JU-1",
      conclusion: "收入方向改善是否可持续仍有争议。",
      supporting_evidence_draft_ids: ["EV-CONTROLLED-01"],
      counter_evidence_draft_ids: ["EV-CONTROLLED-02"],
      uncertainties: ["提前行为与终端需求贡献尚未拆分"],
      invalidation_conditions: ["后续同口径需求和库存序列证实改善延续"],
      competing_explanation: "政策截止期前的提前采购造成短期改善",
      discriminating_evidence: ["政策窗口结束后的同口径订单和库存序列"],
    }]);
    const contestedData = JSON.parse(contested.json_content);
    expect(contestedData.judgments[0]).toMatchObject({ strength: "J0", decision_status: "contested", conflict_status: "unresolved" });
    expect(contestedData.judgments[0].counter_evidence_draft_ids).toEqual(["EV-CONTROLLED-02"]);
    expect(contestedData.signals.map((item: any) => item.role)).toEqual(["support", "weaken"]);
    expect(contestedData.competing_explanations[0]).toMatchObject({ status: "active" });

    const future = db.upsertSource(run.id, {
      url: "https://www.sec.gov/future", title: "Future filing", publisher: "TSMC", published_at: "2025-04-17T00:00:00.000Z",
      source_type: "filing", source_tier: "S1", search_excerpt: "", locator: "paragraph 1", captured_at: "2025-04-17T01:00:00.000Z",
      content_hash: "d".repeat(64), usability_status: "usable", failure_category: "", failure_detail: "",
      final_url: "https://www.sec.gov/future", content_mime: "text/html", http_status: 200,
      retrieval_status: "captured", snapshot_text: quote, source_quote: quote, quote_verified: true,
    });
    expect(() => workflow.createControlledEvidenceProjection(run.id, [{
      source_id: future.id, judgment_unit_ids: ["JU-1"], subject_ref: "revenue", observed_at: "2024-12-31T00:00:00.000Z",
    }])).toThrow(/晚于研究截止时间/);
  });

  it("normalizes the research cutoff and removes free factual prose from Stage01", () => {
    const data = workflow.normalizeStage01Projection({
      normalized_question: "公司营收是否增长？",
      core_object: "公司营收",
      judgment_action: "验证同比方向",
      time_scope: { lookback: "2023", as_of: "2025年1月16日——仅采用当日已公开信息", forward: "不适用" },
      boundaries: ["合并口径"], exclusions: ["不解释原因"], domain_supported: true,
      document_markdown: "未经核验的自由事实",
    }, "截至2025年1月16日，公司营收是否增长？");
    expect(data.time_scope.as_of).toBe("2025-01-16T23:59:59.999+08:00");
    expect(data.document_markdown).not.toContain("未经核验的自由事实");
    expect(data.document_markdown).toContain("不登记事实，不形成方向判断");
    expect(workflow.normalizeBusinessCutoff("as of 2025-01-16, public only")).toBe("2025-01-16T23:59:59.999+08:00");
    expect(workflow.normalizeBusinessCutoff("以2025年上半年公开信息为限")).toBe("2025-06-30T23:59:59.999+08:00");
    expect(workflow.normalizeBusinessCutoff("截至2025年2月")).toBe("2025-02-28T23:59:59.999+08:00");
    expect(workflow.normalizeBusinessCutoff(
      "截至2026年7月",
      new Date("2026-07-28T03:00:00.000Z"),
    )).toBe("2026-07-28T23:59:59.999+08:00");
  });

  it("creates Stage01 and Stage02 controlled projections from a blank run without inventing facts or ontology nodes", () => {
    const run = db.createRun("以2025年上半年公开信息为限，非HBM DRAM是否进入可持续改善？", "semiconductor");
    expect(() => workflow.createStage01DeterministicProjection(run.id)).toThrow(/不得用泛化占位语/);
    const stage01 = workflow.createStage01DeterministicProjection(run.id, {
      normalized_question: "截至2025年上半年，全球非HBM DRAM是否进入可持续改善阶段？",
      core_object: "全球非HBM DRAM；价格、库存与终端需求同口径",
      judgment_action: "裁决改善是否跨价格、库存和需求共同成立，并保留争议或暂不可判断",
      lookback: "2023年至2025年上半年公开信息",
      as_of: "2025年上半年",
      forward: "仅讨论截止时点已可验证的持续性，不外推未来价格",
      boundaries: ["只采用截止时点前公开且可定位的来源", "价格、库存和需求冲突信号必须共同进入裁决"],
      exclusions: ["不做个股建议，不把预测当作已实现事实"],
    });
    const scope = JSON.parse(stage01.json_content);
    expect(stage01).toMatchObject({ status: "needs_review", model_name: "runtime-deterministic-scope-projection" });
    expect(scope.time_scope.as_of).toBe("2025-06-30T23:59:59.999+08:00");
    expect(scope.core_object).toContain("非HBM DRAM");
    expect(scope.document_markdown).toContain("不登记事实，不形成方向判断");
    db.updateArtifact(stage01.id, { status: "approved" });
    const stage02 = workflow.createControlledStructureProjection(run.id, {
      scope_label: "全球非HBM DRAM；价格、库存、采购和政策抢运冲突裁决",
      units: [{
        title: "可持续景气阶段",
        question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
        judgment_type: "cycle_phase",
        evidence_requirements: ["同口径价格序列", "库存与采购时点", "现货和合约需求交叉验证"],
      }],
      counter_evidence_directions: ["库存回升或现货需求谨慎"],
      competing_explanations: ["关税宽限期触发提前采购，价格上涨不可持续"],
    });
    const structure = JSON.parse(stage02.json_content);
    expect(structure.method_applications).toHaveLength(3);
    expect(structure.method_applications.map((item: any) => item.method_id)).toEqual(["BF-SD-01", "kb03:A03", "kb04:A03"]);
    expect(structure.variables[0].ontology_node_id).toBe("task_local:V-CONTROLLED-01");
    expect(structure.judgment_units[0].ontology_node_ids).toEqual([]);
    const edited = workflow.createControlledStructureProjection(run.id, {
      scope_label: "全球非HBM DRAM；价格、库存、采购和政策抢运冲突裁决（修订）",
      units: [{
        id: structure.judgment_units[0].id,
        title: "可持续景气阶段（修订）",
        question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
        judgment_type: "cycle_phase",
        evidence_requirements: ["同口径价格序列", "库存与采购时点", "现货和合约需求交叉验证"],
      }],
      counter_evidence_directions: ["库存回升或现货需求谨慎"],
      competing_explanations: ["关税宽限期触发提前采购，价格上涨不可持续"],
    });
    const editedStructure = JSON.parse(edited.json_content);
    expect(edited.id).toBe(stage02.id);
    expect(editedStructure.research_scope.label).toContain("修订");
    expect(editedStructure.judgment_units[0].title).toContain("修订");
    expect(editedStructure.method_applications.map((item: any) => item.application_id)).toEqual(
      structure.method_applications.map((item: any) => item.application_id),
    );
    expect(editedStructure.document_markdown).toContain("研究逻辑");
  });

  it("revises Stage01 via NL patch hook and gates Stage01 downstream confirmation", async () => {
    const run = db.createRun("以2025年上半年公开信息为限，非HBM DRAM是否进入可持续改善？", "semiconductor");
    const created = await workflow.reviseRunStage(run.id, 1, "建立研究范围", {
      scopePatch: {
        revision_summary: "首次写入范围",
        normalized_question: "截至2025年上半年，全球非HBM DRAM是否进入可持续改善阶段？",
        core_object: "全球非HBM DRAM；价格、库存与终端需求同口径",
        judgment_action: "裁决改善是否跨价格、库存和需求共同成立，并保留争议或暂不可判断",
        lookback: "2023年至2025年上半年公开信息",
        as_of: "2025年上半年",
        forward: "仅讨论截止时点已可验证的持续性，不外推未来价格",
        boundaries: ["只采用截止时点前公开且可定位的来源", "价格、库存和需求冲突信号必须共同进入裁决"],
        exclusions: ["不做个股建议，不把预测当作已实现事实"],
      },
    });
    expect(created.status).toBe("revised");
    if (created.status !== "revised") throw new Error("expected revised");
    expect(JSON.parse(created.artifact.json_content).core_object).toContain("非HBM DRAM");
    db.updateArtifact(created.artifact.id, { status: "approved" });

    const stage02 = workflow.createControlledStructureProjection(run.id, {
      scope_label: "全球非HBM DRAM",
      units: [{
        title: "可持续景气阶段",
        question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
        judgment_type: "cycle_phase",
        evidence_requirements: ["同口径价格序列"],
      }],
      counter_evidence_directions: ["库存回升"],
      competing_explanations: ["提前采购"],
    });
    db.updateArtifact(stage02.id, { status: "approved" });

    const gated = await workflow.reviseRunStage(run.id, 1, "收窄到仅价格", {
      scopePatch: {
        revision_summary: "应收窄对象",
        normalized_question: "截至2025年上半年，全球非HBM DRAM价格是否进入可持续改善？",
        core_object: "全球非HBM DRAM价格",
        judgment_action: "裁决价格改善是否可持续",
        lookback: "2023年至2025年上半年公开信息",
        as_of: "2025年上半年",
        forward: "仅讨论截止时点已可验证的持续性",
        boundaries: ["只采用截止时点前公开且可定位的来源", "只看价格口径"],
        exclusions: ["不做个股建议"],
      },
    });
    expect(gated).toMatchObject({ status: "needs_confirmation" });
    if (gated.status !== "needs_confirmation") throw new Error("expected needs_confirmation");
    expect(gated.affected_downstream.some((item) => item.stage === 2)).toBe(true);

    const revised = await workflow.reviseRunStage(run.id, 1, "确认后收窄", {
      confirm_downstream_invalidate: true,
      scopePatch: {
        revision_summary: "确认后收窄对象到价格",
        normalized_question: "截至2025年上半年，全球非HBM DRAM价格是否进入可持续改善？",
        core_object: "全球非HBM DRAM价格",
        judgment_action: "裁决价格改善是否可持续",
        lookback: "2023年至2025年上半年公开信息",
        as_of: "2025年上半年",
        forward: "仅讨论截止时点已可验证的持续性",
        boundaries: ["只采用截止时点前公开且可定位的来源", "只看价格口径"],
        exclusions: ["不做个股建议"],
      },
    });
    expect(revised.status).toBe("revised");
    if (revised.status !== "revised") throw new Error("expected revised");
    expect(JSON.parse(revised.artifact.json_content).core_object).toContain("价格");
  });

  it("revises Stage02 via NL patch hook and gates unsupported stages / downstream confirmation", async () => {
    const run = db.createRun("以2025年上半年公开信息为限，非HBM DRAM是否进入可持续改善？", "semiconductor");
    const stage01 = workflow.createStage01DeterministicProjection(run.id, {
      normalized_question: "截至2025年上半年，全球非HBM DRAM是否进入可持续改善阶段？",
      core_object: "全球非HBM DRAM；价格、库存与终端需求同口径",
      judgment_action: "裁决改善是否跨价格、库存和需求共同成立，并保留争议或暂不可判断",
      lookback: "2023年至2025年上半年公开信息",
      as_of: "2025年上半年",
      forward: "仅讨论截止时点已可验证的持续性，不外推未来价格",
      boundaries: ["只采用截止时点前公开且可定位的来源", "价格、库存和需求冲突信号必须共同进入裁决"],
      exclusions: ["不做个股建议，不把预测当作已实现事实"],
    });
    db.updateArtifact(stage01.id, { status: "approved" });
    const unsupported = await workflow.reviseRunStage(run.id, 3, "改证据");
    expect(unsupported).toMatchObject({ status: "unsupported", target_stage: 3 });
    const stage02 = await workflow.reviseRunStage(run.id, 2, "保留原结构但改标题", {
      structurePatch: {
        revision_summary: "仅修订标题",
        units: [{
          title: "可持续景气阶段（改稿）",
          question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
          judgment_type: "cycle_phase",
          evidence_requirements: ["同口径价格序列", "库存与采购时点"],
        }],
        counter_evidence_directions: ["库存回升或现货需求谨慎"],
        competing_explanations: ["关税宽限期触发提前采购"],
      },
    });
    expect(stage02.status).toBe("revised");
    if (stage02.status !== "revised") throw new Error("expected revised");
    expect(JSON.parse(stage02.artifact.json_content).judgment_units[0].title).toContain("改稿");

    // Approve stage02 and stage03 stub to trigger downstream confirmation.
    db.updateArtifact(stage02.artifact.id, { status: "approved" });
    const stage03 = db.createArtifact(run.id, "stage_03", {
      status: "approved",
      json_content: "{}",
      markdown_content: "",
      prompt_version: "test",
      knowledge_version: "test",
    });
    expect(stage03.status).toBe("approved");
    const gated = await workflow.reviseRunStage(run.id, 2, "再改一次", {
      structurePatch: {
        revision_summary: "应先确认下游",
        units: [{
          id: JSON.parse(stage02.artifact.json_content).judgment_units[0].id,
          title: "可持续景气阶段（再改）",
          question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
          judgment_type: "cycle_phase",
          evidence_requirements: ["同口径价格序列"],
        }],
        counter_evidence_directions: ["库存回升"],
        competing_explanations: ["提前采购"],
      },
    });
    expect(gated).toMatchObject({ status: "needs_confirmation" });
    if (gated.status !== "needs_confirmation") throw new Error("expected needs_confirmation");
    expect(gated.affected_downstream.some((item) => item.stage === 3)).toBe(true);

    const confirmed = await workflow.reviseRunStage(run.id, 2, "确认后改稿", {
      confirm_downstream_invalidate: true,
      structurePatch: {
        revision_summary: "确认后修订",
        units: [{
          title: "可持续景气阶段（确认后）",
          question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
          judgment_type: "cycle_phase",
          evidence_requirements: ["同口径价格序列"],
        }],
        counter_evidence_directions: ["库存回升"],
        competing_explanations: ["提前采购"],
      },
    });
    expect(confirmed.status).toBe("revised");
  });

  it("revises Stage04 via judgment patch hook and gates Stage05 downstream confirmation", async () => {
    const run = db.createRun("判断裁决改稿测试", "semiconductor");
    const stage01 = workflow.createStage01DeterministicProjection(run.id, {
      normalized_question: "截至2025年上半年，全球非HBM DRAM是否进入可持续改善阶段？",
      core_object: "全球非HBM DRAM；价格、库存与终端需求同口径",
      judgment_action: "裁决改善是否跨价格、库存和需求共同成立，并保留争议或暂不可判断",
      lookback: "2023年至2025年上半年公开信息",
      as_of: "2025年上半年",
      forward: "仅讨论截止时点已可验证的持续性，不外推未来价格",
      boundaries: ["只采用截止时点前公开且可定位的来源", "价格、库存和需求冲突信号必须共同进入裁决"],
      exclusions: ["不做个股建议，不把预测当作已实现事实"],
    });
    db.updateArtifact(stage01.id, { status: "approved" });
    const stage02 = workflow.createControlledStructureProjection(run.id, {
      scope_label: "全球非HBM DRAM",
      units: [{
        title: "可持续景气阶段",
        question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
        judgment_type: "cycle_phase",
        evidence_requirements: ["同口径价格序列"],
      }],
      counter_evidence_directions: ["库存回升"],
      competing_explanations: ["提前采购"],
    });
    db.updateArtifact(stage02.id, { status: "approved" });

    const source = db.upsertSource(run.id, {
      url: "https://example.com/source",
      title: "Test source",
      publisher: "Example",
      published_at: "2025-01-10T00:00:00.000Z",
      source_type: "news",
      source_tier: "S1",
      search_excerpt: "",
      locator: "p1",
      captured_at: "2025-01-10T01:00:00.000Z",
      content_hash: "a".repeat(64),
      usability_status: "usable",
      failure_category: "",
      failure_detail: "",
      final_url: "https://example.com/source",
      content_mime: "text/html",
      http_status: 200,
      retrieval_status: "captured",
      snapshot_text: "公开披露显示价格同比改善",
      source_quote: "公开披露显示价格同比改善",
      quote_verified: true,
    });
    const stage03 = workflow.createControlledEvidenceProjection(run.id, [{
      source_id: source.id,
      judgment_unit_ids: [JSON.parse(stage02.json_content).judgment_units[0].id],
      subject_ref: "dram_price",
      observed_at: "2024-12-31T00:00:00.000Z",
      direction: "support",
    }]);
    db.updateArtifact(stage03.id, { status: "approved" });
    const stage04 = workflow.createControlledJudgmentProjection(run.id, [{
      judgment_unit_id: JSON.parse(stage02.json_content).judgment_units[0].id,
      conclusion: "在当前证据边界内，价格改善方向成立。",
      supporting_evidence_draft_ids: ["EV-CONTROLLED-01"],
      uncertainties: ["样本期较短"],
      invalidation_conditions: ["后续同口径价格回落"],
      competing_explanation: "短期扰动导致的暂时改善",
      discriminating_evidence: ["后续两个季度的同口径连续序列"],
      confirmed_precondition_ids: ["state_measurement_or_equivalent_baseline"],
    }]);
    db.updateArtifact(stage04.id, { status: "approved" });
    const stage05 = db.createArtifact(run.id, "stage_05", {
      status: "approved",
      json_content: "{}",
      markdown_content: "",
      prompt_version: "test",
      knowledge_version: "test",
    });
    expect(stage05.status).toBe("approved");

    const gated = await workflow.reviseRunStage(run.id, 4, "收紧结论", {
      judgmentPatch: {
        revision_summary: "先触发下游确认",
        judgments: [{
          judgment_unit_id: JSON.parse(stage02.json_content).judgment_units[0].id,
          conclusion: "方向仍待更多序列确认，暂不升级强判断。",
          supporting_evidence_draft_ids: ["EV-CONTROLLED-01"],
          counter_evidence_draft_ids: [],
          rationale: "当前只有单来源单期事实，先保持保守结论。",
          uncertainties: ["样本期较短"],
          invalidation_conditions: ["后续同口径价格回落"],
          competing_explanation: "短期扰动导致的暂时改善",
          source_explanation_id: "CE-CONTROLLED-01",
          discriminating_evidence: ["后续两个季度的同口径连续序列"],
          counterevidence_resolution: "",
          confirmed_precondition_ids: ["state_measurement_or_equivalent_baseline"],
          tracking_signals: ["季度价格序列连续性"],
          conditions: ["仅在当前冻结时间窗内成立"],
        }],
      },
    });
    expect(gated).toMatchObject({ status: "needs_confirmation", target_stage: 4 });
    if (gated.status !== "needs_confirmation") throw new Error("expected needs_confirmation");
    expect(gated.affected_downstream.some((item) => item.stage === 5)).toBe(true);

    const revised = await workflow.reviseRunStage(run.id, 4, "确认后收紧结论", {
      confirm_downstream_invalidate: true,
      judgmentPatch: {
        revision_summary: "收紧为保守裁决",
        judgments: [{
          judgment_unit_id: JSON.parse(stage02.json_content).judgment_units[0].id,
          conclusion: "方向仍待更多序列确认，暂不升级强判断。",
          supporting_evidence_draft_ids: ["EV-CONTROLLED-01"],
          counter_evidence_draft_ids: [],
          rationale: "当前只有单来源单期事实，先保持保守结论。",
          uncertainties: ["样本期较短"],
          invalidation_conditions: ["后续同口径价格回落"],
          competing_explanation: "短期扰动导致的暂时改善",
          source_explanation_id: "CE-CONTROLLED-01",
          discriminating_evidence: ["后续两个季度的同口径连续序列"],
          counterevidence_resolution: "",
          confirmed_precondition_ids: ["state_measurement_or_equivalent_baseline"],
          tracking_signals: ["季度价格序列连续性"],
          conditions: ["仅在当前冻结时间窗内成立"],
        }],
      },
    });
    expect(revised.status).toBe("revised");
    if (revised.status !== "revised") throw new Error("expected revised");
    const data = JSON.parse(revised.artifact.json_content);
    expect(data.judgments[0].conclusion).toContain("暂不升级强判断");
  });

  it("flags title/question swaps and does not let an external ok bypass Stage02 quality gates", async () => {
    const issues = workflow.heuristicStructureIssues({
      scope_label: "测试",
      units: [{
        id: "JU-1",
        title: "价格改善是否由真实需求支持？",
        question: "短标题",
        judgment_type: "cycle_phase",
        evidence_requirements: ["价格序列"],
      }],
      counter_evidence_directions: ["库存回升"],
      competing_explanations: ["抢运"],
    }, { core_object: "DRAM", judgment_action: "裁决" });
    expect(issues.some((item) => item.code === "title_question_mismatch")).toBe(true);

    const run = db.createRun("以2025年上半年公开信息为限，非HBM DRAM是否进入可持续改善？", "semiconductor");
    const stage01 = workflow.createStage01DeterministicProjection(run.id, {
      normalized_question: "截至2025年上半年，全球非HBM DRAM是否进入可持续改善阶段？",
      core_object: "全球非HBM DRAM；价格、库存与终端需求同口径",
      judgment_action: "裁决改善是否跨价格、库存和需求共同成立，并保留争议或暂不可判断",
      lookback: "2023年至2025年上半年公开信息",
      as_of: "2025年上半年",
      forward: "仅讨论截止时点已可验证的持续性，不外推未来价格",
      boundaries: ["只采用截止时点前公开且可定位的来源", "价格、库存和需求冲突信号必须共同进入裁决"],
      exclusions: ["不做个股建议，不把预测当作已实现事实"],
    });
    db.updateArtifact(stage01.id, { status: "approved" });
    const stage02 = workflow.createControlledStructureProjection(run.id, {
      units: [{
        title: "可持续景气阶段",
        question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
        judgment_type: "cycle_phase",
        evidence_requirements: ["同口径价格序列"],
      }],
      counter_evidence_directions: ["库存回升"],
      competing_explanations: ["提前采购"],
    });
    const blocked = await workflow.validateStage02ForApproval(run.id, {
      validationResult: {
        ok: false,
        summary: "标题与问题不一致",
        issues: [{ severity: "error", code: "title_question_mismatch", message: "标题与问题不一致", unit_id: "JU-CONTROLLED-01" }],
        suggested_patch: {
          units: [{
            id: JSON.parse(stage02.json_content).judgment_units[0].id,
            title: "可持续景气阶段",
            question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
            judgment_type: "cycle_phase",
            evidence_requirements: ["同口径价格序列", "库存时点"],
          }],
          counter_evidence_directions: ["库存回升"],
          competing_explanations: ["提前采购"],
        },
      },
    });
    expect(blocked.ok).toBe(false);
    const applied = await workflow.validateStage02ForApproval(run.id, {
      applySuggestedPatch: true,
      validationResult: {
        ok: false,
        summary: "给出补丁",
        issues: [{ severity: "error", code: "missing_evidence", message: "证据不足" }],
        suggested_patch: {
          units: [{
            id: JSON.parse(stage02.json_content).judgment_units[0].id,
            title: "可持续景气阶段",
            question: "价格改善是否由真实需求与库存去化共同支持，而非短期抢运？",
            judgment_type: "cycle_phase",
            evidence_requirements: ["同口径价格序列", "库存时点"],
          }],
          counter_evidence_directions: ["库存回升"],
          competing_explanations: ["提前采购"],
        },
      },
    });
    expect(applied.artifact).toBeTruthy();
    expect(JSON.parse(applied.artifact!.json_content).judgment_units[0].evidence_requirements).toContain("库存时点");
    const ok = await workflow.validateStage02ForApproval(run.id, {
      validationResult: { ok: true, summary: "可通过", issues: [], suggested_patch: null },
    });
    expect(ok.ok).toBe(false);
    expect(ok.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "quality_status" }),
    ]));

    const createClient = vi.fn(() => {
      throw new Error("人工受控结构不应调用付费模型校验");
    });
    const deterministic = await workflow.validateStage02ForApproval(run.id, { createClient: createClient as any });
    expect(deterministic.ok).toBe(false);
    expect(deterministic.summary).toContain("未通过确定性确认前校验");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("filters model review demands that contradict the formal Stage02 contract", () => {
    const structure = {
      scope_label: "存储周期",
      units: [{
        id: "JU-1",
        title: "HBM",
        question: "未来六个月是否改善？",
        judgment_type: "cycle_phase",
        evidence_requirements: ["ER-1"],
      }],
      evidence_requirement_registry: [{
        id: "ER-1",
        requirement: "HBM 合约价、库存天数与终端部署的多期对照",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
      }],
      counter_evidence_directions: [{
        direction_id: "CD-1",
        statement: "库存重新累积",
        judgment_unit_ids: ["JU-1"],
      }],
      competing_explanations: [{
        explanation_id: "CE-1",
        statement: "一次性补库",
        judgment_unit_ids: ["JU-1"],
        discriminating_evidence: ["终端消耗与库存的多期对照"],
      }],
    };
    expect(workflow.structureValidationIssueConflictsWithContract({
      severity: "error",
      code: "EVIDENCE_REQUIREMENTS_PLACEHOLDER",
      message: "evidence_requirements 只是 ID",
    }, structure)).toBe(true);
    expect(workflow.structureValidationIssueConflictsWithContract({
      severity: "error",
      code: "COUNTER_EVIDENCE_MISSING_REQUIRED_FIELDS",
      message: "缺少 explanation_id、id、discriminating_evidence",
    }, structure)).toBe(true);
    expect(workflow.structureValidationIssueConflictsWithContract({
      severity: "error",
      code: "semantic_mismatch",
      message: "问题与判断类型不一致",
    }, structure)).toBe(false);
  });

  it("builds an honest gap-only evidence artifact without inventing facts", () => {
    const candidate = {
      application_id: "MA-EVIDENCE-GAP", method_id: "kb03:A02", method_version: "3.2.0", capability_type: "evidence",
      target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [], status: "candidate",
      precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [], execution_summary: "",
      applicability_boundary: "库存状态", limitations: [], counter_example_refs: [],
      provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null }, alternatives: [],
    } as any;
    const data = workflow.buildEvidenceGapFallback({
      judgment_units: [{ id: "JU-1", title: "库存", evidence_requirements: ["两项独立库存序列"], ontology_node_ids: ["SV-1"] }],
      method_applications: [candidate],
    }, "来源取得失败");
    expect(data.sources).toEqual([]);
    expect(data.evidence_drafts).toHaveLength(1);
    expect(data.evidence_drafts[0].kind).toBe("gap");
    expect(data.method_applications[0].status).toBe("blocked");
    expect(data.method_applications[0].input_evidence_refs).toEqual([data.evidence_drafts[0].id]);
  });

  it("repairs near-miss Stage 03 drafts that omit gap bindings and blocked alternatives", async () => {
    const repaired = workflow.repairEvidencePreparationDraft({
      method_applications: [
        {
          application_id: "MA-EV-1", method_id: "kb03:A02", method_version: "3.2.0", capability_type: "evidence",
          target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [],
          status: "blocked", precondition_checks: [], input_evidence_refs: [], output_signal_refs: [],
          output_judgment_refs: [], execution_summary: "", applicability_boundary: "折旧", limitations: [],
          counter_example_refs: [], provenance: { stage: "stage_03", source_application_id: "MA-EV-1", actor: "model", recorded_at: null },
          alternatives: [],
        },
        {
          application_id: "MA-ADJ-1", method_id: "kb04:A01", method_version: "1.0.0", capability_type: "adjudication",
          target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [],
          status: "candidate", precondition_checks: [], input_evidence_refs: [], output_signal_refs: [],
          output_judgment_refs: [], execution_summary: "", applicability_boundary: "估值", limitations: [],
          counter_example_refs: [], provenance: { stage: "stage_03", source_application_id: "MA-ADJ-1", actor: "model", recorded_at: null },
          alternatives: [],
        },
      ],
      sources: [],
      evidence_drafts: [{
        id: "GAP-JU-01", statement: "缺少可核验折旧披露", kind: "gap", direction: "unknown", source_keys: [], source_ids: [],
        judgment_unit_ids: ["JU-1"], ontology_node_ids: [], requirement: "取得折旧口径与金额",
        evidence_role: "support", minimum_independent_sources: 1, limitations: ["检索未取得可定位正文"],
      }],
      unresolved_gaps: ["GAP-JU-01"],
      document_markdown: "# 证据准备\n\n未取得可核验正文，仅登记缺口；blocked 方法需绑定替代路线并引用 gap。",
    });
    expect(repaired.method_applications[0].input_evidence_refs).toEqual(["GAP-JU-01"]);
    expect(repaired.method_applications[0].alternatives).toEqual([
      expect.objectContaining({ method_id: "kb03:A02", decision: "retry_after_source_acquisition" }),
    ]);
    const { evidencePreparationSchema } = await import("@/engine/schemas");
    const { syncStage03ReadableMarkdown } = await import("@/engine/readable_markdown");
    syncStage03ReadableMarkdown(repaired);
    expect(() => evidencePreparationSchema.parse(repaired)).not.toThrow();
  });

  it("builds J0 judgments that trace to blocked adjudication methods", () => {
    const adjudication = {
      application_id: "MA-J0-ADJ", method_id: "kb04:A01", method_version: "1.0.0", capability_type: "adjudication",
      target_question_refs: ["Q-1"], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [], status: "candidate",
      precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [], execution_summary: "",
      applicability_boundary: "库存状态", limitations: [], counter_example_refs: [],
      provenance: { stage: "stage_03", source_application_id: "MA-J0-ADJ", actor: "test", recorded_at: null }, alternatives: [],
    } as any;
    const data = workflow.buildJudgmentGapFallback(
      { research_scope: { id: "SCOPE-1" }, judgment_units: [{ id: "JU-1", title: "库存", evidence_requirements: ["库存序列"], ontology_node_ids: [] }] },
      { method_applications: [adjudication], evidence_drafts: [{ id: "GAP-1", kind: "gap", judgment_unit_ids: ["JU-1"] }] },
      "只有证据缺口",
    );
    expect(data.signals).toEqual([]);
    expect(data.judgments[0]).toMatchObject({ strength: "J0", decision_status: "indeterminate", method_application_ids: ["MA-J0-ADJ"] });
    expect(data.method_applications[0].status).toBe("blocked");
  });

  it("aligns Stage05 claims to judgments without flattening a report body into audit-voiced brief", () => {
    const reportBody = [
      "# 当前暂不可形成方向判断",
      "",
      "## 投资要点",
      "",
      "- **价格方向暂不可判断。** 缺少价格序列。",
      "",
      "## 核心结论概览",
      "",
      "| 项目 | 结论 |",
      "|---|---|",
      "| 当前判断 | 暂不可形成方向判断 |",
      "",
      "## 市场认知差 / Research Edge",
      "",
      "| 参考认识 | 本次差异化判断 | 被低估的机制 | 什么会证伪 | 证据边界 |",
      "|---|---|---|---|---|",
      "| 市场预期上行 | 证据不足不能确认 | 公开序列缺失 | 取得连续价格 | 仅限已确认判断 |",
      "",
      "## 一、价格证据不足",
      "",
      "- 当前暂不可形成方向判断。",
      "",
      "## 二、验证窗口",
      "",
      "- 取得事实级证据后再判断。",
      "",
      "## 投资含义与重点观察",
      "",
      "| 对象/环节 | 当前判断 | 关键依据 | 后续观察 | 主要风险 |",
      "|---|---|---|---|---|",
      "| 价格 | 暂不可判断 | 证据缺口 | 价格序列 | 外推 |",
      "",
      "## 催化、验证与风险",
      "",
      "### 未来重点观察",
      "",
      "| 时间或频率 | 指标/事件 | 当前基线 | 触发条件 | 对判断的影响 | 首选来源 |",
      "|---|---|---|---|---|---|",
      "| 下季度 | 价格 | 未知 | 连续两期 | 改判 | 公司披露 |",
      "",
      "### 主要风险",
      "",
      "- 缺少价格序列。",
      "",
      "## 主要资料来源",
      "",
      "- 无",
    ].join("\n");
    const data = workflow.normalizeStage05Projection({
      title: "未经约束的方向标题", executive_points: ["HBM消耗三倍晶圆面积"],
      report_claims: [{ id: "RC-1", statement: "预计价格上行", judgment_ids: ["J-1"], method_application_ids: ["MA-1"], evidence_draft_ids: [], source_ids: [] }],
      limitations: ["模型自由限制"], document_markdown: reportBody,
    }, {
      overall_boundary: "上游只有证据缺口",
      judgments: [{ id: "J-1", title: "价格方向", conclusion: "当前暂不可形成方向判断", strength: "J0", decision_status: "indeterminate", uncertainties: ["缺少价格序列"], invalidation_conditions: ["取得事实级证据"] }],
    }, "价格是否改善？", []);
    expect(data.report_claims[0].statement).toContain("当前暂不可形成方向判断");
    expect(data.report_claims[0].statement).not.toMatch(/J0\/indeterminate/);
    expect(data.document_markdown).toContain("## 投资要点");
    expect(data.document_markdown).toContain("## 市场认知差 / Research Edge");
    expect(data.document_markdown).toContain("## 一、价格证据不足");
    expect(data.document_markdown).not.toContain("研究判断简报");
    expect(data.document_markdown).not.toContain("<details>");
    expect(data.document_markdown).not.toContain("审计索引");
    // 保留模型研报结构，不因对齐 claim 而整篇重写
    expect(data.document_markdown).toContain("## 一、价格证据不足");
  });

  it("does not cite degraded Stage04 methods as executed Stage05 report methods", () => {
    const data = workflow.normalizeStage05Projection({
      title: "方法追溯",
      executive_points: ["方法追溯"],
      report_claims: [{
        id: "RC-1",
        statement: "原始表述",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-EXEC", "MA-DEGRADED"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: [],
      document_markdown: "# 短稿",
    }, {
      overall_boundary: "仅限方向判断",
      judgments: [{
        id: "J-1",
        title: "价格方向",
        conclusion: "当前暂不可形成方向判断",
        strength: "J0",
        decision_status: "indeterminate",
        method_application_ids: ["MA-EXEC", "MA-DEGRADED"],
        uncertainties: ["缺少价格序列"],
        invalidation_conditions: ["取得事实级证据"],
      }],
      method_applications: [
        { application_id: "MA-EXEC", status: "executed" },
        { application_id: "MA-DEGRADED", status: "degraded" },
      ],
    }, "价格是否改善？", []);
    expect(data.report_claims[0].method_application_ids).toEqual(["MA-EXEC"]);
    expect(data.expression_audit_yaml).toContain("MA-EXEC");
    expect(data.expression_audit_yaml).not.toContain("MA-DEGRADED");
  });

  it("rebuilds a non-report seed into 05C skeleton without audit voice", () => {
    const data = workflow.normalizeStage05Projection({
      title: "未经约束的方向标题", executive_points: ["HBM消耗三倍晶圆面积"],
      report_claims: [{ id: "RC-1", statement: "预计价格上行", judgment_ids: ["J-1"], method_application_ids: ["MA-1"], evidence_draft_ids: [], source_ids: [] }],
      limitations: ["模型自由限制"], document_markdown: "# 自由正文\n\nHBM消耗三倍晶圆面积，并将推动全行业上涨。",
    }, {
      overall_boundary: "上游只有证据缺口",
      judgments: [{ id: "J-1", title: "价格方向", conclusion: "当前暂不可形成方向判断", strength: "J0", decision_status: "indeterminate", uncertainties: ["缺少价格序列"], invalidation_conditions: ["取得事实级证据"] }],
    }, "价格是否改善？", []);
    expect(data.document_markdown).not.toContain("三倍晶圆面积");
    expect(data.document_markdown).not.toContain("全行业上涨");
    expect(data.document_markdown).toContain("## 投资要点");
    expect(data.document_markdown).toContain("## 核心结论概览");
    expect(data.document_markdown).toContain("## 市场认知差 / Research Edge");
    expect(data.document_markdown).toMatch(/## [一二]、/);
    expect(data.document_markdown).not.toContain("J0/indeterminate");
    expect(data.document_markdown).not.toContain("审计索引");
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
      ...semanticExecution.REQUIRED_RULES.map((rule, index) => ({ id: `RE-${index + 1}`, type: "RuleEvaluation", properties: { rule_ref: rule, input_refs: ["EV-1"], condition_results: [{ condition_id: "runtime", outcome: "pass" }], result: "pass", deterministic_result: { engine_version: semanticExecution.ENGINE_VERSION, result: "pass" } } })),
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
        ruleEvaluationRefs: semanticExecution.REQUIRED_RULES.map((_, index) => `RE-${index + 1}`), methodApplicationRefs: ["MA-TEST"],
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
        inputRefs: ["SCOPE-1", "JU-1", "EV-1", "SIG-1", hyp.written_object_ids[0], ...semanticExecution.REQUIRED_RULES.map((_, index) => `RE-${index + 1}`)],
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
    const structurePlan = { ...baseMa, application_id: "MA-PUBLISH-STRUCTURE", method_id: "BF-SD-01", method_version: "2.0.0", capability_type: "judgment_structure" as const };
    const evidencePlan = { ...baseMa, application_id: "MA-PUBLISH-EVIDENCE", method_id: "kb03:A02", method_version: "3.2.0", capability_type: "evidence" as const };
    const stage01 = { normalized_question: "测试可发布研究", core_object: "库存", judgment_action: "状态判断", time_scope: { lookback: "一年", as_of: cutoff, forward: "一季度" }, boundaries: ["半导体"], exclusions: ["交易建议"], domain_supported: true, document_markdown: "# 任务\n\n围绕库存是否下降形成可证伪研究任务，冻结研究对象、截止时间、观察区间和不包含交易建议的表达边界。" };
    const stage02 = {
      method_applications: [structurePlan, evidencePlan, baseMa], research_scope: { id: "SCOPE-1", label: "半导体库存范围", dimensions: { domain: "semiconductor" } },
      judgment_units: [{ id: "JU-1", title: "库存", question: "库存是否下降", judgment_type: "state_measurement", scope_ref: "SCOPE-1", ontology_node_ids: ["SV-INV"], evidence_requirements: ["需要可定位库存事实"] }],
      variables: [{ id: "SV-INV", name: "inventory", category: "operations", definition: "可比口径库存", variable_kind: "observed", anchors: ["inventory"], ontology_node_id: "task_local:SV-INV", role: "target" }],
      paths: [{ id: "PATH-1", statement: "库存变化形成状态信号", variable_ids: ["SV-INV"] }], counter_evidence_directions: ["库存回升"], competing_explanations: ["季节性波动"], document_markdown: "# 结构\n\n建立单一原子判断单元、冻结范围、状态变量、可证伪路径、反证方向和竞争解释，并绑定候选方法应用。",
    };
    const source = db.upsertSource(run.id, {
      url: "https://example.com/publish-source", title: "可验证来源", publisher: "Example", published_at: "2026-07-18",
      source_type: "disclosure", source_tier: "S2", source_group: "example.com", search_excerpt: "库存下降", locator: "quote:库存下降", captured_at: cutoff,
      content_hash: "a".repeat(64), usability_status: "usable", failure_category: "", failure_detail: "",
      final_url: "https://example.com/publish-source", content_mime: "text/html", http_status: 200, retrieval_status: "captured",
      snapshot_text: "库存下降", source_quote: "库存下降", quote_verified: true,
    });
    const stage03Checks = [{ precondition_id: "state_variable_defined", result: "pass" as const, evidence_refs: ["EV-1"], reason: "ok" }, { precondition_id: "observation_scope_aligned", result: "pass" as const, evidence_refs: ["EV-1"], reason: "ok" }];
    const selectedStructure = { ...structurePlan, status: "selected" as const, provenance: { ...structurePlan.provenance, stage: "stage_03" as const, source_application_id: structurePlan.application_id }, precondition_checks: stage03Checks, input_evidence_refs: ["EV-1"] };
    const selectedEvidence = { ...evidencePlan, status: "selected" as const, provenance: { ...evidencePlan.provenance, stage: "stage_03" as const, source_application_id: evidencePlan.application_id }, precondition_checks: stage03Checks, input_evidence_refs: ["EV-1"] };
    const selected = { ...baseMa, status: "candidate" as const, provenance: { ...baseMa.provenance, stage: "stage_03" as const, source_application_id: "MA-PUBLISH" } };
    const sourceDraft = { source_id: source.id, source_key: "SRC-1", url: source.url, title: source.title, publisher: source.publisher, published_at: "2026-07-18T00:00:00Z", source_tier: "S2", source_type: "disclosure", search_excerpt: "库存下降", locator: "quote:库存下降", source_quote: "库存下降", captured_at: cutoff, content_hash: "a".repeat(64), final_url: source.url, retrieval_status: "captured", quote_verified: true };
    const stage03 = { method_applications: [selectedStructure, selectedEvidence, selected], sources: [sourceDraft], evidence_drafts: [{ id: "EV-1", statement: "可比口径库存下降", kind: "fact_draft", direction: "support", source_keys: ["SRC-1"], source_ids: [source.id], judgment_unit_ids: ["JU-1"], ontology_node_ids: ["SV-INV"], subject_ref: "SV-INV", time_basis: "observation_time", scope_ref: "SCOPE-1", observed_at: "2026-07-17T00:00:00Z", valid_from: "2026-07-17T00:00:00Z", valid_to: null, published_at: "2026-07-18T00:00:00Z", cutoff_at: cutoff, directness: "direct", limitations: [] }], unresolved_gaps: [], document_markdown: "# 证据\n\n正文已抓取并完成事实级定位、来源哈希冻结、发布时间核验、范围与观察时间对齐；该事实已绑定取证方法和原子判断单元。" };
    const execute = (application: typeof selectedStructure | typeof selectedEvidence | typeof selected, outputSignalRefs: string[], outputJudgmentRefs: string[]) => ({ ...application, status: "executed" as const, provenance: { ...application.provenance, stage: "stage_04" as const, recorded_at: cutoff }, output_signal_refs: outputSignalRefs, output_judgment_refs: outputJudgmentRefs, execution_summary: "完成有边界状态裁决", precondition_checks: stage03Checks, input_evidence_refs: ["EV-1"] });
    const executedStructure = execute(selectedStructure, [], ["J-1"]);
    const executedEvidence = execute(selectedEvidence, ["SIG-1"], []);
    const executed = execute(selected, ["SIG-1"], ["J-1"]);
    const ruleNames = [...semanticExecution.REQUIRED_RULES];
    const rules = ruleNames.map((rule_ref, index) => ({ id: `RE-${index + 1}`, rule_ref, judgment_id: "J-1", input_refs: ["EV-1"], condition_results: [{ condition_id: "runtime", expression: "verified", input_refs: ["EV-1"], outcome: "pass", rationale: "verified" }], result: "pass", deterministic_result: { engine_version: "runtime-semantic-rules-3.0.0", result: "pass", rationale: "verified", evaluated_at: cutoff } }));
    const stage04 = { method_applications: [executedStructure, executedEvidence, executed], signals: [{ id: "SIG-1", statement: "库存下降构成支持信号", role: "support", evidence_draft_ids: ["EV-1"], judgment_unit_ids: ["JU-1"], target_hypothesis_ids: ["H-1"] }], hypotheses: [{ id: "H-1", statement: "库存处于下降阶段", signal_ids: ["SIG-1"], falsification_conditions: ["库存回升"], time_horizon: "一季度" }], competing_explanations: [{ id: "CE-1", statement: "季节性波动", signal_ids: ["SIG-1"], discriminating_evidence: ["跨季对照"], status: "weakened", elimination_rationale: "部分削弱" }], rule_evaluations: rules, judgments: [{ id: "J-1", judgment_unit_id: "JU-1", title: "库存观察", conclusion: "库存存在下降迹象", rationale: "一组直接来源仅支持 J1", strength: "J1", confidence: "low", decision_status: "supported", conflict_status: "none", not_judgeable_reason: null, scope_ref: "SCOPE-1", cutoff_at: cutoff, conditions: [], supporting_evidence_draft_ids: ["EV-1"], counter_evidence_draft_ids: [], hypothesis_ids: ["H-1"], rule_evaluation_ids: rules.map((rule) => rule.id), method_application_ids: ["MA-PUBLISH"], ontology_node_ids: ["SV-INV"], uncertainties: ["样本短"], invalidation_conditions: ["库存回升"], tracking_signals: ["库存"] }], reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["SCOPE-1", "JU-1", "EV-1", "SIG-1", "H-1", ...rules.map((rule) => rule.id), "MA-PUBLISH", "J-1"], created_at: cutoff }], overall_boundary: "仅限本范围", document_markdown: "# 判断\n\n当前只有一组直接来源，确定性规则将证据上限限制在 J1；保留季节性竞争解释和库存回升失效条件，不外推为确定趋势。" };
    const stage05Body = [
      "# 库存存在下降迹象",
      "",
      "## 投资要点",
      "",
      "- **库存存在下降迹象。** 仅一组直接来源，结论保持观察层。",
      "",
      "## 核心结论概览",
      "",
      "| 项目 | 结论 |",
      "|---|---|",
      "| 当前判断 | 库存存在下降迹象 |",
      "",
      "## 市场认知差 / Research Edge",
      "",
      "| 参考认识 | 本次差异化判断 | 被低估的机制 | 什么会证伪 | 证据边界 |",
      "|---|---|---|---|---|",
      "| 库存已企稳 | 仅见下降迹象 | 样本有限 | 库存回升 | 单来源 |",
      "",
      "## 一、库存变化",
      "",
      "- 库存存在下降迹象。",
      "",
      "## 二、证据边界",
      "",
      "- 仅一组直接来源。",
      "",
      "## 投资含义与重点观察",
      "",
      "| 对象/环节 | 当前判断 | 关键依据 | 后续观察 | 主要风险 |",
      "|---|---|---|---|---|",
      "| 库存 | 下降迹象 | EV-1 | 下季披露 | 季节性 |",
      "",
      "## 催化、验证与风险",
      "",
      "### 未来重点观察",
      "",
      "| 时间或频率 | 指标/事件 | 当前基线 | 触发条件 | 对判断的影响 | 首选来源 |",
      "|---|---|---|---|---|---|",
      "| 下季 | 库存 | 下降迹象 | 回升 | 削弱 | 公司披露 |",
      "",
      "### 主要风险",
      "",
      "- 仅一组直接来源。",
      "",
      "## 主要资料来源",
      "",
      `- [${source.title}](${source.url})`,
    ].join("\n");
    const stage05 = {
      title: "测试报告",
      executive_points: ["库存存在下降迹象"],
      report_claims: [{ id: "EX-1", statement: "库存存在下降迹象", judgment_ids: ["J-1"], method_application_ids: ["MA-PUBLISH"], evidence_draft_ids: ["EV-1"], source_ids: [source.id] }],
      limitations: ["仅一组直接来源"],
      document_markdown: stage05Body,
      quality_status: "high_quality_pass",
    };
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
      db.updateArtifact(draft.id, { status: "approved", approved_at: cutoff });
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
        sources: [{ ...sourceDraft, url: "https://evil.example/forged", content_hash: "f".repeat(64) }],
        document_markdown: "# 伪造来源测试\n\n该产物故意改绑到不同 URL 并篡改正文哈希，用于证明确认流程会拒绝与 Source Registry 身份不一致的绑定；同 URL 的冻结字段漂移会在确认前由 Registry 投影回草稿。",
      }),
      markdown_content: stage03.document_markdown,
    });
    // 新质量门禁可能先于 Registry 身份核对拒绝这份伪造稿；两者都必须阻止确认。
    expect(() => workflow.approve(spoofedEvidence.id)).toThrow(/Source Registry 不一致|质量门禁未通过/);

    const untracedExpression = db.createArtifact(run.id, "stage_05", {
      status: "needs_review",
      json_content: JSON.stringify({
        ...stage05,
        report_claims: [{ ...stage05.report_claims[0], evidence_draft_ids: [] }],
        // 无论由结构质量门还是事实追溯门先命中，都不能确认这份无追溯表达。
        document_markdown: stage05Body,
        quality_status: "high_quality_pass",
      }),
      markdown_content: stage05Body,
    });
    expect(() => workflow.approve(untracedExpression.id)).toThrow(/缺少事实级 evidence_draft_ids|尚未达到可交接密度/);
    const unreviewedJudgment = db.createArtifact(run.id, "stage_04", {
      status: "needs_review",
      json_content: JSON.stringify(stage04),
      markdown_content: stage04.document_markdown,
      model_name: "producer-model",
    });
    expect(() => workflow.approve(unreviewedJudgment.id)).toThrow(/未创建审阅工作项|质量门禁未通过|尚未达到可交接密度/);
    const humanReview = workflow.createControlledIndependentReview(run.id, {
      reviewer: "reviewer-zhang",
      attestation: "本人未参与该判断生产，并确认不存在影响独立判断的利益冲突。",
      verdict: "pass",
      strengths: ["证据、方法和判断追溯完整"],
      overall_assessment: "经独立核查，结论强度与冻结证据边界一致。",
    });
    workflow.approve(humanReview.id);
    const republished = publish.publishAndValidate(run.id);
    expect(republished.validate_ok).toBe(true);
    expect(republished.validation_summary.publish_status).toBe("workbench_validate_passed");
  });

  it("blocks publish before report, independent review and object work are cleared", () => {
    const run = db.createRun("发布阻断测试", "semiconductor");
    expect(() => publish.publishAndValidate(run.id)).toThrow(/阶段 05 尚未确认/);
  });

  it("creates a fresh deterministic Stage05 without requiring a model-written seed", () => {
    const run = db.createRun("无模型表达闭环", "semiconductor");
    db.createArtifact(run.id, "stage_03", {
      status: "approved",
      json_content: JSON.stringify({ evidence_drafts: [{ id: "EV-1", source_ids: ["SRC-1"] }] }),
      model_name: "human-controlled-evidence-projection",
    });
    db.createArtifact(run.id, "stage_04", {
      status: "approved",
      json_content: JSON.stringify({
        overall_boundary: "仅限冻结证据与研究截止时间",
        judgments: [{
          id: "J-1", title: "持续性", conclusion: "当前暂不可确认持续性", strength: "J0", decision_status: "contested",
          supporting_evidence_draft_ids: ["EV-1"], counter_evidence_draft_ids: [], method_application_ids: ["MA-1"],
          uncertainties: ["独立来源不足"], invalidation_conditions: ["新增独立来源"],
        }],
      }),
      model_name: "human-controlled-judgment-projection",
    });
    const report = workflow.createStage05DeterministicProjection(run.id);
    const data = JSON.parse(report.json_content);
    expect(report).toMatchObject({ status: "needs_review", model_name: "runtime-deterministic-expression-projection" });
    expect(data.report_claims[0]).toMatchObject({ judgment_ids: ["J-1"], method_application_ids: ["MA-1"], evidence_draft_ids: ["EV-1"], source_ids: ["SRC-1"] });
    expect(data.document_markdown).toContain("当前暂不可确认持续性");
  });

  it("accepts an attested non-producer human review and rejects self-review", () => {
    const run = db.createRun("人类独立审阅合同", "semiconductor");
    db.createArtifact(run.id, "stage_04", {
      status: "approved", json_content: JSON.stringify({ judgments: [] }), model_name: "producer-model",
    });
    expect(() => workflow.createControlledIndependentReview(run.id, {
      reviewer: "producer-model",
      attestation: "本人未参与该判断生产，并确认不存在影响独立判断的利益冲突。",
      verdict: "pass", strengths: ["边界清楚"], overall_assessment: "证据与判断边界一致。",
    })).toThrow(/不能与 Stage04 生产者相同/);
    const review = workflow.createControlledIndependentReview(run.id, {
      reviewer: "reviewer-zhang",
      attestation: "本人未参与该判断生产，并确认不存在影响独立判断的利益冲突。",
      verdict: "pass", strengths: ["边界清楚"], overall_assessment: "证据与判断边界一致。",
    });
    expect(JSON.parse(review.json_content)).toMatchObject({ reviewer_type: "human", independence_level: "independent_human", reviewer_model: "human:reviewer-zhang" });
    expect(() => workflow.approve(review.id)).not.toThrow();
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
