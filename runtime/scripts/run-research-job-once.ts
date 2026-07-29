import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runResearchJobById } from "../engine/research_job_runner";

function clearInheritedProxyEnv() {
  for (const key of [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
    "SOCKS_PROXY", "SOCKS5_PROXY", "socks_proxy", "socks5_proxy",
  ]) {
    delete process.env[key];
  }
}

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

async function main() {
  const jobArg = process.argv.indexOf("--job-id");
  const jobId = jobArg >= 0 ? String(process.argv[jobArg + 1] || "") : "";
  if (!jobId) throw new Error("必须通过 --job-id 指定唯一任务；一次性执行器不会领取队列中的其他任务");
  clearInheritedProxyEnv();
  loadEnvLocal();
  const result = await runResearchJobById(jobId, {
    workerId: `one-shot-worker-${process.pid}`,
  });
  process.stdout.write(`${JSON.stringify({
    id: result?.id,
    run_id: result?.run_id,
    stage: result?.stage,
    status: result?.status,
    artifact_id: result?.artifact_id,
    result: result?.result_json ? JSON.parse(result.result_json) : {},
    last_error: result?.last_error,
  }, null, 2)}\n`);
}

void main().catch((error) => {
  console.error("[research-job-once] fatal", error);
  process.exitCode = 1;
});
