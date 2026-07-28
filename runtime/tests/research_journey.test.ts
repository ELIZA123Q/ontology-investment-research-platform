import { describe, expect, it } from "vitest";
import {
  RESEARCH_STAGE_JOURNEY,
  formatJourneyOutput,
  journeyApproveLabel,
  journeyNextHref,
  researchStage,
  validateJourney,
} from "@/app/lib/research-journey";

describe("researcher journey contract", () => {
  it("passes validateJourney with no errors", () => {
    expect(validateJourney()).toEqual([]);
  });

  it("defines five contiguous stages with a unique review scene", () => {
    expect(RESEARCH_STAGE_JOURNEY.map((item) => item.stage)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(RESEARCH_STAGE_JOURNEY.map((item) => item.reviewPath)).size).toBe(5);
    expect(new Set(RESEARCH_STAGE_JOURNEY.map((item) => item.kind)).size).toBe(5);
  });

  it("makes every stage scenario, output and confirmation decision explicit", () => {
    for (const stage of RESEARCH_STAGE_JOURNEY) {
      expect(stage.scenarioQuestion.length).toBeGreaterThan(4);
      expect(stage.scenarioHint.length).toBeGreaterThan(8);
      expect(stage.editHint.length).toBeGreaterThan(8);
      expect(stage.output.length).toBeGreaterThan(8);
      expect(stage.outputFallback.length).toBeGreaterThan(4);
      expect(stage.outputNote.length).toBeGreaterThan(8);
      expect(stage.confirmation).toMatch(/[？?]$/);
      expect(stage.nextStep.label.length).toBeGreaterThan(2);
      expect(stage.navLabel).not.toMatch(/Stage|stage_|J[0-4]|JSON|YAML|闸门|缺口/);
      expect(stage.editTitle).not.toMatch(/Stage|stage_|J[0-4]|JSON|YAML|闸门|缺口/);
      expect(stage.scenarioQuestion).not.toMatch(/闸门|缺口/);
      expect(stage.confirmation).not.toMatch(/闸门|缺口/);
    }
  });

  it("resolves a stage to the same contract used by navigation and editors", () => {
    expect(researchStage(3)).toMatchObject({
      navLabel: "证据",
      editTitle: "证据准备",
      reviewPath: "/evidence",
      scenarioQuestion: "证据够不够，还有哪些关键材料没拿到？",
      nextStep: { pathSuffix: "/judgments" },
    });
  });

  it("formats output templates with and without count", () => {
    const withCount = researchStage(2)!;
    expect(formatJourneyOutput(withCount, { count: 3 })).toBe("3 个关键判断及其必要证据");
    expect(formatJourneyOutput(withCount)).toBe("等待形成关键判断");
    expect(formatJourneyOutput(withCount, { count: 0 })).toBe("等待形成关键判断");

    const plain = researchStage(1)!;
    expect(formatJourneyOutput(plain, { count: 1 })).toBe("可执行、可证伪的研究问题");
    expect(formatJourneyOutput(plain, { count: 0 })).toBe("等待收敛研究问题");
  });

  it("builds post-confirm hrefs and approve labels from the journey", () => {
    expect(journeyNextHref("run-1", 1)).toBe("/runs/run-1/structure");
    expect(journeyNextHref("run-1", 5)).toBe("/runs/run-1");
    expect(journeyApproveLabel(1)).toContain("确认范围");
    expect(journeyApproveLabel(5)).toBe("确认交付");
  });
});
