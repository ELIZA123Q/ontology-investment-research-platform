import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EvidenceFact } from "@/src/contracts";
import { assessResearchMethods, deriveEvidenceRoles, selectResearchMethods } from "@/src/research/method-router";
import { normalizeReportSpec } from "@/src/reporting/report-spec";

const fact = (id: string, statement: string): EvidenceFact => ({
  id, snapshotId: `snapshot-${id}`, statement, evidenceRoles: deriveEvidenceRoles(statement),
  factType: "reported_fact", confidence: "high", status: "verified", createdAt: "2026-08-09T00:00:00.000Z",
});

describe("governed research method router", () => {
  it("routes a semiconductor industry report to cycle and industry overlays", () => {
    const plan = selectResearchMethods("研究未来六个月存储芯片供需、价格与竞争格局", normalizeReportSpec({ kind: "industry_research" }));
    const cycle = plan.applications.find((item) => item.sectionKey === "cycle_supply_demand")!;
    expect(cycle.frameworkIds).toEqual(["BF-SD-01", "IF-SC-01"]);
    expect(cycle.evidenceMethodId).toBe("kb03:A03");
    expect(cycle.adjudicationMethodId).toBe("kb04:A03");
    expect(plan.exitCondition).toContain("不得");
  });

  it("records evidence-role coverage without claiming framework execution", () => {
    const selected = selectResearchMethods("研究存储芯片供需周期", normalizeReportSpec({ kind: "industry_research" }));
    const assessed = assessResearchMethods(selected, [
      fact("d", "服务器需求与订单继续增长"), fact("s", "有效供给和产能增加"), fact("p", "合约价格持续上涨"),
    ], true);
    const core = assessed.applications.find((item) => item.sectionKey === "core_judgments")!;
    expect(core.missingEvidenceRoles).toEqual([]);
    expect(core.evidenceFactIds).toEqual(["d", "s", "p"]);
    expect(core.gateStatus).toBe("passed");
  });

  it("keeps every projected method and framework resolvable to governed registries", () => {
    const plan = selectResearchMethods("研究存储芯片供需、竞争、情景和估值", normalizeReportSpec({ kind: "industry_research", optionalSections: ["scenario_analysis", "valuation_scenarios"] }));
    const frameworkRegistry = readFileSync("../03_agent_capability/05_method_libraries/02_研究框架/registry.yaml", "utf8");
    const evidenceRegistry = readFileSync("../03_agent_capability/05_method_libraries/03_取证/03_registry.yaml", "utf8");
    const routeRegistry = readFileSync("../05_control_evaluation/02_合同/judgment_method_routes.yaml", "utf8");
    for (const application of plan.applications) {
      for (const id of application.frameworkIds) expect(frameworkRegistry).toContain(`${id}:`);
      expect(evidenceRegistry).toContain(`method: ${application.evidenceMethodId.replace("kb03:", "")}`);
      expect(routeRegistry).toContain(`default_kb04_method: ${application.adjudicationMethodId}`);
    }
  });
});
