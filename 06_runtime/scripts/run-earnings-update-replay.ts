import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEarningsUpdateReplay, type EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = process.argv[2] ? resolve(process.argv[2]) : resolve(runtimeRoot, "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as EarningsUpdateReplayFixture;
const result = runEarningsUpdateReplay(fixture);
const outputDir = resolve(runtimeRoot, ".data/evals");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `earnings-update-replay-${Date.now()}.json`);
writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), fixturePath, ...result }, null, 2));
console.log(JSON.stringify({ outputPath, passed: result.passed, outcome: result.outcome, judgment: result.judgment, outputChecks: result.outputChecks, valuationStatus: result.valuationStatus, limitations: result.limitations }, null, 2));
if (!result.passed) process.exitCode = 1;
