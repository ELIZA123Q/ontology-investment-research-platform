import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { KnowledgeBundleLoader } from "@investment/knowledge";
import { EarningsUpdateGoldenService } from "@/src/application/earnings-update-golden-service";
import type { EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";

const databases: DatabaseSync[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json"), "utf8")) as EarningsUpdateReplayFixture;
const loader = () => new KnowledgeBundleLoader(resolve(process.cwd(), ".data/knowledge-bundles"));

describe("orchestrated earnings-update golden path", () => {
  it("runs the frozen case through four constrained agents and three human gates", async () => {
    const db = new DatabaseSync(":memory:"); databases.push(db);
    const result = await new EarningsUpdateGoldenService(db, loader()).run(fixture);
    expect(result.passed).toBe(true);
    expect(result.workOrders.map((item) => item.order.nodeKind)).toEqual([
      "evidence_capture", "financial_normalization", "model_build_or_update", "judgment", "independent_review", "compose",
    ]);
    expect(new Set(result.workOrders.map((item) => item.order.assignedAgent))).toEqual(new Set(["research-lead", "evidence-investigator", "financial-modeler", "independent-critic"]));
    expect(result.events.filter((item) => item.type === "approval.approved").map((item) => item.payload.gate)).toEqual(["evidence_confirmation", "judgment_confirmation", "publish_confirmation"]);
    expect(result.artifacts.find((item) => item.kind === "financial_model")?.content).toMatchObject({ audit: { passed: true } });
  });

  it("stops deterministically when a required human gate is not approved", async () => {
    const db = new DatabaseSync(":memory:"); databases.push(db);
    const result = await new EarningsUpdateGoldenService(db, loader()).run(fixture, (gate) => gate !== "judgment_confirmation");
    expect(result).toMatchObject({ status: "waiting_approval", waitingFor: "judgment_confirmation", passed: false });
    expect(result.artifacts.map((item) => item.kind)).toEqual(["evidence_package", "normalized_financials", "financial_model", "judgment"]);
    expect(result.workOrders.some((item) => item.order.assignedAgent === "independent-critic")).toBe(false);
  });
});
