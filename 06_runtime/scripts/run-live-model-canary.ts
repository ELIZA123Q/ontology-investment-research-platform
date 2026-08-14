import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import catalogJson from "../../05_control_evaluation/05_evals/fixtures/live-canary-cases.json";
import { runLiveCanaryCase, validateLiveCanaryCatalog, type LiveCanaryCatalog } from "../src/evaluation/live-model-canary";
import { providerFromEnv } from "../src/providers/model-provider";
import { RuntimeStore } from "../src/runtime/store";

const localEnv = resolve(process.cwd(), ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const catalog = catalogJson as LiveCanaryCatalog;
const catalogFailures = validateLiveCanaryCatalog(catalog);
if (catalogFailures.length) throw new Error(catalogFailures.join("; "));
if (process.env.VNEXT_PROVIDER !== "deepseek") throw new Error("Set VNEXT_PROVIDER=deepseek for this cost-bounded canary");
const provider = providerFromEnv();
if (!provider || provider.id !== "deepseek") throw new Error("DeepSeek provider is not configured; DEEPSEEK_API_KEY and DEEPSEEK_MODEL are required");

const requested = process.argv.find((value) => value.startsWith("--case="))?.slice("--case=".length);
const selected = requested ? catalog.cases.filter((item) => item.id === requested) : catalog.cases.slice(0, 3);
if (!selected.length) throw new Error(`Unknown canary case: ${requested}`);
const databasePath = resolve(process.env.VNEXT_CANARY_DB_PATH || ".data/evals/live-canary.sqlite");
const store = new RuntimeStore(databasePath);
try {
  const results = [];
  for (const item of selected) {
    const result = await runLiveCanaryCase(store, provider, catalog, item);
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.caseId} ${result.cached ? "cached" : "live"} input=${result.usage?.inputTokens || "?"} output=${result.usage?.outputTokens || "?"}`);
  }
  const output = {
    schemaName: "public_live_research_canary_run", schemaVersion: "1.0.0", formalScoreEligible: false,
    provider: provider.id, model: results[0]?.model, createdAt: new Date().toISOString(), results,
  };
  const outputDirectory = resolve(".data/evals");
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `live-canary-${Date.now()}.json`);
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`result=${outputPath}`);
  console.log("FORMAL_SCORE_NOT_ASSERTED: this is a public-data engineering canary, not a blinded or human-rated evaluation.");
  if (results.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  store.close();
}
