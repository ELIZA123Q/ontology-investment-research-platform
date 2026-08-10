import { describe, expect, it } from "vitest";
import { normalizeReportSpec, reportSpecForGoal } from "@/src/reporting/report-spec";

describe("professional report specification", () => {
  it("keeps professional sections mandatory while allowing bounded personalization", () => {
    const spec = normalizeReportSpec({
      kind: "company_research", audience: "investment_committee", depth: "deep",
      optionalSections: ["alternative_hypotheses", "executive_summary"],
      customInstructions: "重点比较资本开支情景",
    });
    expect(spec).toMatchObject({ kind: "company_research", audience: "investment_committee", depth: "deep" });
    expect(spec.sections).toEqual(expect.arrayContaining([
      "executive_summary", "research_scope", "core_judgments", "evidence_analysis",
      "business_model", "financial_operating_analysis", "competitive_landscape", "valuation_scenarios",
      "alternative_hypotheses", "risks_change_conditions", "source_appendix",
    ]));
    expect(new Set(spec.sections).size).toBe(spec.sections.length);
    expect(normalizeReportSpec(spec)).toEqual(spec);
  });

  it("infers a professional default without trusting arbitrary section names", () => {
    const spec = reportSpecForGoal("研究存储芯片行业周期与供需变化", {
      optionalSections: ["scenario_analysis", "made_up_section" as never],
    });
    expect(spec.kind).toBe("industry_research");
    expect(spec.sections).toContain("cycle_supply_demand");
    expect(spec.sections).toContain("scenario_analysis");
    expect(spec.sections).not.toContain("made_up_section" as never);
  });
});
