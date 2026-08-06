import { describe, expect, it } from "vitest";
import {
  defaultMethodIdsForJudgmentType,
  loadMethodRegistry,
  methodRoutesForPrompt,
  recallRegisteredMethodCandidates,
  validateMethodRoutes,
  validateRegisteredMethodApplications,
} from "@/skills/method_selection/method_registry";
import {
  buildStageGenerationGuidance,
  enrichPromptMethodCards,
  evidenceJudgmentTypeCardsForPrompt,
  excerptMethodBody,
  frameworkMarkdownIndex,
  guidanceMethodIdsForStage,
  judgmentThresholdCapsForPrompt,
  loadSelectedMethodGuidance,
  loadScenarioCardGuidance,
  matchScenarioCards,
} from "@/skills/method_selection/method_guidance";
import { registeredFiles } from "@/skills/method_selection/knowledge_loader";
import type { MethodApplication } from "@/schemas/types";

function application(overrides: Partial<MethodApplication> = {}): MethodApplication {
  return {
    application_id: "MA-01",
    method_id: "kb04:A02",
    method_version: "1.0.0",
    capability_type: "adjudication",
    target_question_refs: ["Q-01"],
    target_judgment_unit_refs: ["JU-01"],
    target_ontology_object_refs: [],
    status: "candidate",
    precondition_checks: [],
    input_evidence_refs: [],
    output_signal_refs: [],
    output_judgment_refs: [],
    execution_summary: "",
    applicability_boundary: "趋势判断",
    limitations: [],
    counter_example_refs: [],
    provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
    alternatives: [],
    ...overrides,
  };
}

describe("method registry", () => {
  it("loads structure, evidence and adjudication methods", () => {
    const registry = loadMethodRegistry();
    expect(registry.get("BF-SD-01")?.capability_type).toBe("judgment_structure");
    expect(registry.get("kb03:A03")?.method_version).toBe("3.2.0");
    expect(registry.get("kb04:A02")?.method_version).toBe("1.0.0");
    expect(registry.get("kb04:A00")?.capability_type).toBe("adjudication");
    expect(registry.get("kb03:A03")?.preconditions.length).toBeGreaterThan(0);
    expect(registry.size).toBe(43);
  });

  it("rejects unknown methods and version drift", () => {
    expect(() => validateRegisteredMethodApplications([application()])).not.toThrow();
    expect(() => validateRegisteredMethodApplications([application({ method_id: "kb04:UNKNOWN" })])).toThrow(/未登记方法/);
    expect(() => validateRegisteredMethodApplications([application({ method_version: "9.9.9" })])).toThrow(/版本不匹配/);
  });

  it("enforces judgment-type method routes", () => {
    const units = [{ id: "JU-01", judgment_type: "trend_direction" }];
    expect(() => validateMethodRoutes([application({ status: "executed" })], units)).not.toThrow();
    expect(() => validateMethodRoutes([
      application({ method_id: "kb04:A03", status: "candidate" }),
    ], units)).toThrow(/不允许用于/);
  });

  it("allows kb03:A01 as start-fact evidence for transmission_path", () => {
    const units = [{ id: "JU-02", judgment_type: "transmission_path" }];
    expect(() => validateMethodRoutes([
      application({
        application_id: "MA-JU02-EVID",
        method_id: "kb03:A01",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_judgment_unit_refs: ["JU-02"],
        status: "candidate",
      }),
    ], units)).not.toThrow();
    expect(() => validateMethodRoutes([
      application({
        application_id: "MA-JU02-EVID",
        method_id: "kb03:A02",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_judgment_unit_refs: ["JU-02"],
        status: "candidate",
      }),
    ], units)).toThrow(/不允许用于/);
  });

  it("allows A02 as the required state baseline for cycle-phase A03", () => {
    const units = [{ id: "JU-CYCLE", judgment_type: "cycle_phase" }];
    expect(() => validateMethodRoutes([
      application({
        application_id: "MA-CYCLE-BASELINE",
        method_id: "kb03:A02",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_judgment_unit_refs: ["JU-CYCLE"],
        status: "candidate",
      }),
      application({
        application_id: "MA-CYCLE-PRIMARY",
        method_id: "kb03:A03",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_judgment_unit_refs: ["JU-CYCLE"],
        status: "candidate",
      }),
    ], units)).not.toThrow();
    expect(methodRoutesForPrompt().routes.cycle_phase.default_kb03_method).toBe("kb03:A03");
  });

  it("exposes full method routes for prompts", () => {
    const routes = methodRoutesForPrompt();
    expect(routes.routes.transmission_path.allowed_kb03_methods).toEqual(
      expect.arrayContaining(["kb03:A01", "kb03:A04"]),
    );
    expect(routes.routes.transmission_path.default_kb03_method).toBe("kb03:A04");
    expect(routes.routes.transmission_path.normal_max_j).toBe("J3");
    expect(routes.routes.transmission_path.required_preconditions).toEqual(
      expect.arrayContaining(["start_fact_identified", "path_nodes_defined"]),
    );
    expect(routes.routes.transmission_path.upgrade_to_j4_requires.length).toBeGreaterThan(0);
  });

  it("keeps rejected methods route-valid and allows global A00", () => {
    const units = [{ id: "JU-01", judgment_type: "trend_direction" }];
    expect(() => validateMethodRoutes([
      application({ method_id: "kb04:A03", status: "rejected" }),
    ], units)).toThrow(/不允许用于/);
    expect(() => validateMethodRoutes([
      application({ method_id: "kb04:A00", status: "executed" }),
    ], units)).not.toThrow();
  });
});

describe("method guidance injection", () => {
  it("enriches framework cards with output gate requires", () => {
    const cards = enrichPromptMethodCards([loadMethodRegistry().get("BF-SD-01")!]);
    expect(cards[0].output_gates?.balance_state?.requires?.length).toBeGreaterThan(0);
    expect(cards[0].output_gates?.balance_state?.minimum_evidence?.length).toBeGreaterThan(0);
    expect(cards[0].downstream_unlocks?.length).toBeGreaterThan(0);
  });

  it("enriches evidence cards with roles and judgment type rows", () => {
    const cards = enrichPromptMethodCards(
      [loadMethodRegistry().get("kb03:A04")!],
      ["transmission_path"],
    );
    expect(cards[0].required_roles).toEqual(expect.arrayContaining(["primary", "mechanism", "counter"]));
    expect(cards[0].judgment_type_rows?.some((row) => row.judgment_type === "transmission_path")).toBe(true);
  });

  it("loads selected method bodies for inherited kb03/kb04 ids", () => {
    const guidance = loadSelectedMethodGuidance(["kb03:A02", "kb04:A03"]);
    expect(guidance.map((item) => item.method_id)).toEqual(["kb03:A02", "kb04:A03"]);
    expect(guidance[0].excerpt).toMatch(/状态|测量|A02/);
    expect(guidance[1].excerpt).toMatch(/阶段|A03|裁决/);
    expect(guidance[0].file).toContain("A02");
    expect(guidance[0].excerpt_mode).toBe("full");
  });

  it("resolves framework markdown for structure method guidance", () => {
    expect(frameworkMarkdownIndex().get("BF-SD-01")).toMatch(/供需判断框架/);
    const guidance = loadSelectedMethodGuidance(["BF-SD-01"]);
    expect(guidance).toHaveLength(1);
    expect(guidance[0].excerpt).toMatch(/BF-SD-01|供需/);
  });

  it("routes only structure bodies into stage_02 guidance while keeping cross-stage routes in candidates", () => {
    const cycleTask = "存储芯片库存周期阶段判断";
    const cycleIds = guidanceMethodIdsForStage(
      "stage_02",
      recallRegisteredMethodCandidates(cycleTask),
      cycleTask,
    );
    const cycle = defaultMethodIdsForJudgmentType("cycle_phase");
    expect(cycleIds).toEqual([cycle.judgment_structure]);

    const pathTask = "管制政策向设备采购的传导路径";
    const pathIds = guidanceMethodIdsForStage(
      "stage_02",
      recallRegisteredMethodCandidates(pathTask),
      pathTask,
    );
    const transmission = defaultMethodIdsForJudgmentType("transmission_path");
    expect(pathIds).toEqual([transmission.judgment_structure]);
  });

  it("filters stage_03 to kb03 and stage_04 to kb04 including A00", () => {
    const mixed = [
      loadMethodRegistry().get("BF-SD-01")!,
      loadMethodRegistry().get("kb03:A03")!,
      loadMethodRegistry().get("kb03:A04")!,
      loadMethodRegistry().get("kb04:A03")!,
      loadMethodRegistry().get("kb04:A06")!,
    ];
    expect(guidanceMethodIdsForStage("stage_03", mixed)).toEqual(["kb03:A03", "kb03:A04"]);
    const stage04 = guidanceMethodIdsForStage("stage_04", mixed);
    expect(stage04).toEqual(expect.arrayContaining(["kb04:A00", "kb04:A03", "kb04:A06"]));
    expect(stage04.every((id) => id.startsWith("kb04:"))).toBe(true);
    expect(stage04).not.toEqual(expect.arrayContaining(["BF-SD-01", "kb03:A03"]));
  });

  it("uses section excerpt mode when body exceeds cap", () => {
    const longDoc = [
      "# Title",
      "",
      "lead paragraph about framework_id BF-TEST",
      "",
      "## 适用条件",
      "when to use",
      "",
      "## 停止条件与边界",
      "must stop here when evidence thin",
      "",
      "## 其他细节",
      "x".repeat(200),
    ].join("\n");
    const result = excerptMethodBody(longDoc, 120);
    expect(result.excerpt_mode).toBe("sections");
    expect(result.truncated).toBe(true);
    expect(result.excerpt).toMatch(/lead paragraph|停止|边界/);
  });

  it("buildStageGenerationGuidance assembles ids and excerpts", () => {
    const mixed = [
      loadMethodRegistry().get("BF-SD-01")!,
      loadMethodRegistry().get("kb03:A03")!,
      loadMethodRegistry().get("kb04:A03")!,
    ];
    const built = buildStageGenerationGuidance({ kind: "stage_03", candidates: mixed });
    expect(built.method_ids).toEqual(["kb03:A03"]);
    expect(built.selected_method_guidance).toHaveLength(1);
    expect(built.selected_method_guidance[0].method_id).toBe("kb03:A03");
  });

  it("projects threshold caps and evidence judgment type cards", () => {
    const caps = judgmentThresholdCapsForPrompt();
    expect(caps.evidence_grade_caps.Q2).toBe("J2");
    expect(caps.level_outputs.J3.allowed_04_output).toBeTruthy();
    const cards = evidenceJudgmentTypeCardsForPrompt(["cycle_phase"]);
    expect(cards.cycle_phase.method).toBe("kb03:A03");
    expect(cards.cycle_phase.required_roles).toEqual(
      expect.arrayContaining(["primary", "baseline", "cross_check", "counter"]),
    );
  });

  it("matches SCN-MEM-CYCLE / SCN-MEM-HBM scenario cards from task text", () => {
    const cycle = matchScenarioCards("存储芯片周期是否见顶，DRAM 与 NAND 是否分化");
    expect(cycle.map((item) => item.scenario_id)).toContain("SCN-MEM-CYCLE");
    const hbm = matchScenarioCards("HBM 供需与对通用 DRAM 的资源挤占");
    expect(hbm.map((item) => item.scenario_id)).toEqual(expect.arrayContaining(["SCN-MEM-HBM"]));
    expect(matchScenarioCards("无关宏观问题")).toEqual([]);
  });

  it("injects scenario card guidance ahead of methods for stage_02 memory-cycle tasks", () => {
    const registry = loadMethodRegistry();
    const candidates = [...registry.values()].slice(0, 20);
    const built = buildStageGenerationGuidance({
      kind: "stage_02",
      candidates,
      taskText: "存储芯片周期何时结束：DRAM/NAND/HBM 分产品判断",
    });
    expect(built.scenario_card_ids).toEqual(expect.arrayContaining(["SCN-MEM-CYCLE", "SCN-MEM-HBM"]));
    expect(built.selected_method_guidance[0]?.method_id).toMatch(/^SCN-MEM-/);
    const loaded = loadScenarioCardGuidance("存储周期见顶");
    expect(loaded.some((item) => item.method_id === "SCN-MEM-CYCLE" && item.excerpt.includes("分产品"))).toBe(true);
  });
});

describe("runtime knowledge contexts", () => {
  it("loads stage_01 template and stage_02 appendix", () => {
    expect(registeredFiles("stage_01")).toEqual(expect.arrayContaining([
      "runtime/workflow/stage_specs/01_受理/模板/01_投研需求说明模板.md",
    ]));
    expect(registeredFiles("stage_02")).toEqual(expect.arrayContaining([
      "runtime/workflow/stage_specs/02_结构/02_附录1_框架裁剪与选用细则.md",
    ]));
  });

  it("loads B00/B01/B03/OPS for stage_03 and omits routes yaml from stage_04 knowledge", () => {
    expect(registeredFiles("stage_03")).toEqual(expect.arrayContaining([
      "knowledge/evidence_strategy/B00_来源选择与使用边界.md",
      "knowledge/evidence_strategy/B01_通用来源速查.md",
      "knowledge/evidence_strategy/B03_MCP通道注册.md",
      "knowledge/evidence_strategy/OPS_MCP查询快速参考.md",
    ]));
    expect(registeredFiles("stage_04")).not.toContain("governance/contracts/judgment_method_routes.yaml");
  });

  it("injects the blocking protocol for all Stage04 judgment types", () => {
    const without = registeredFiles("stage_04", { judgmentTypes: ["trend_direction"] });
    const withPath = registeredFiles("stage_04", { judgmentTypes: ["transmission_path"] });
    expect(without).toContain("knowledge/adjudication/A00-附录1_路径与阻断协议.md");
    expect(withPath).toContain("knowledge/adjudication/A00-附录1_路径与阻断协议.md");
  });

  it("loads only the matching stage_05 archetype template", () => {
    const cycle = registeredFiles("stage_05", { deliveryArchetype: "industry_cycle_report" });
    const event = registeredFiles("stage_05", { deliveryArchetype: "event_commentary" });
    expect(cycle.filter((file) => /delivery\/02_模板\/05[A-E]_/.test(file))).toEqual([
      "knowledge/expression/templates/05C_行业周期判断模板.md",
    ]);
    expect(event.filter((file) => /delivery\/02_模板\/05[A-E]_/.test(file))).toEqual([
      "knowledge/expression/templates/05A_事件点评模板.md",
    ]);
  });
});
