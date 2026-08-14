import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import catalogJson from "../../05_control_evaluation/05_evals/fixtures/live-canary-cases.json";
import { runLiveCanaryTrack, validateLiveCanaryCatalog, type LiveCanaryCatalog, type LiveCanaryTrack } from "../src/evaluation/live-model-canary";
import { providerFromEnv } from "../src/providers/model-provider";
import { RuntimeStore } from "../src/runtime/store";

const localEnv = resolve(process.cwd(), ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const catalog = catalogJson as LiveCanaryCatalog;
const validation = validateLiveCanaryCatalog(catalog);
if (validation.length) throw new Error(validation.join("; "));
if (process.env.VNEXT_PROVIDER !== "deepseek") throw new Error("Set VNEXT_PROVIDER=deepseek for this cost-bounded public-evidence pilot");
const provider = providerFromEnv();
if (!provider || provider.id !== "deepseek") throw new Error("DeepSeek provider is not configured; DEEPSEEK_API_KEY and DEEPSEEK_MODEL are required");
const requested = process.argv.find((value) => value.startsWith("--case="))?.slice("--case=".length) || "live-smic-guidance-restraint";
const item = catalog.cases.find((candidate) => candidate.id === requested);
if (!item) throw new Error(`Unknown public-evidence pilot case: ${requested}`);

const databasePath = resolve(process.env.VNEXT_CANARY_DB_PATH || ".data/evals/live-canary.sqlite");
const store = new RuntimeStore(databasePath);
try {
  const tracks: LiveCanaryTrack[] = ["system", "direct_qa", "evidence_summary"];
  const results = [];
  for (const track of tracks) {
    const result = await runLiveCanaryTrack(store, provider, catalog, item, track);
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${track} ${result.cached ? "cached" : "live"} input=${result.usage?.inputTokens || "?"} output=${result.usage?.outputTokens || "?"}`);
  }
  const output = {
    schemaName: "public_same_evidence_pilot", schemaVersion: "1.0.0", formalScoreEligible: false,
    runMode: "pipeline_only", caseId: item.id, provider: provider.id, model: results[0]?.model,
    createdAt: new Date().toISOString(), evidencePolicy: "public_only", results,
    interpretationBoundary: "仅验证三条同证据生成路径的结构与安全结果；未进行盲评、裁判校准、R/U/delta/S/C 或研究价值比较。",
  };
  const outputDirectory = resolve(".data/evals");
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `public-evidence-pilot-${Date.now()}.json`);
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`result=${outputPath}`);
  console.log("FORMAL_SCORE_NOT_ASSERTED: one public same-evidence pilot is diagnostic only; it is not a blinded or calibrated research-value evaluation.");
  if (results.some((result) => !result.passed)) process.exitCode = 1;
} finally {
  store.close();
}
