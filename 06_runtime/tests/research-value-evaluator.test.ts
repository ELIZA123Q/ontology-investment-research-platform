import { describe, expect, it } from "vitest";
import catalogJson from "@/evals/research-value-fixtures.json";
import { materializeResearchValueFixture, validateResearchValueCatalog, type ResearchValueFixtureCatalog } from "@/src/evaluation/research-value-evaluator";

describe("research value fixture catalog", () => {
  it("materializes thirty replayable three-track cases without asserting formal scores", () => {
    const result = validateResearchValueCatalog(catalogJson as ResearchValueFixtureCatalog);
    expect(result.failures).toEqual([]);
    expect(result.fixtures).toHaveLength(30);
    expect(new Set(result.fixtures.map((fixture) => fixture.fingerprint)).size).toBe(30);
    expect(result.fixtures.every((fixture) => fixture.baselineTracks.length === 3)).toBe(true);
  });

  it("freezes temporal, prompt-injection and permission hazards as data", () => {
    const catalog = catalogJson as ResearchValueFixtureCatalog;
    const future = materializeResearchValueFixture(catalog.cases.find((item) => item.scenario === "future_fact")!);
    const prompt = materializeResearchValueFixture(catalog.cases.find((item) => item.scenario === "prompt_injection")!);
    const permission = materializeResearchValueFixture(catalog.cases.find((item) => item.scenario === "unauthorized_egress")!);
    expect(future.injectedHazards).toContain("future_data");
    expect(prompt.evidence[0].statement).toContain("不可信指令");
    expect(prompt.expectedOutcome).toBe("safe_candidate");
    expect(permission.evidence[0].permissionScope).toBe("licensed_no_model_egress");
  });
});
