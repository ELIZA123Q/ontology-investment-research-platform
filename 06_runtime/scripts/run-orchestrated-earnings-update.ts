import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { KnowledgeBundleLoader } from "@investment/knowledge";
import type { EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";
import { EarningsUpdateGoldenService } from "@/src/application/earnings-update-golden-service";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json"), "utf8")) as EarningsUpdateReplayFixture;
const db = new DatabaseSync(":memory:");
try {
  const result = await new EarningsUpdateGoldenService(db, new KnowledgeBundleLoader(resolve(process.cwd(), ".data/knowledge-bundles"))).run(fixture);
  console.log(JSON.stringify({
    schemaName: "orchestrated_earnings_update_golden_run", schemaVersion: "1.0.0",
    runId: result.runId, status: result.status, passed: result.passed,
    agents: [...new Set(result.workOrders.map((item) => item.order.assignedAgent))],
    nodeKinds: result.workOrders.map((item) => item.order.nodeKind),
    artifactKinds: result.artifacts.map((item) => item.kind),
    approvals: result.events.filter((item) => item.type.startsWith("approval.")).map((item) => item.payload),
    outputChecks: result.replay.outputChecks, limitations: result.replay.limitations,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  db.close();
}
