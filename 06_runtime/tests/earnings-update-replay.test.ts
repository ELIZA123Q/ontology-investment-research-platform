import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runEarningsUpdateReplay, type EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";

describe("frozen public earnings update replay", () => {
  it("recomputes the issuer figures, supports only the descriptive judgment and blocks causal overreach and valuation", () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json"), "utf8")) as EarningsUpdateReplayFixture;
    const result = runEarningsUpdateReplay(fixture);
    expect(result.passed).toBe(true);
    expect(result.outcome).toBe("completed_with_judgment");
    expect(result.judgment).toContain("收入增长尚未伴随营业利润同步改善");
    expect(result.outputChecks.every((check) => check.passed)).toBe(true);
    expect(result.valuationStatus).toBe("blocked");
    expect(result.valuationGate.passed).toBe(false);
    expect(result.limitations).toEqual(expect.arrayContaining(fixture.expected.requiredLimitations));
  });
});
