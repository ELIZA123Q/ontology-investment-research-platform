import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runResearchWorkerLoop } from "../runner/research_job_runner";

/**
 * Cursor / 沙箱常注入失效的 HTTP(S)_PROXY；Node 会走代理导致 DeepSeek Connection error。
 * 与 scripts/dev-singleton.sh 对齐，启动时清掉代理。
 */
function clearInheritedProxyEnv() {
  for (const key of [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
    "SOCKS_PROXY", "SOCKS5_PROXY", "socks_proxy", "socks5_proxy",
  ]) {
    delete process.env[key];
  }
}

/** Next.js 会自动读 .env.local；独立 worker 不会，必须显式加载。 */
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
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

clearInheritedProxyEnv();
loadEnvLocal();

const controller = new AbortController();
const workerId = process.env.RESEARCH_WORKER_ID || `research-worker-${process.pid}`;

process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

async function main() {
  console.log(`[research-worker] started worker_id=${workerId}`);
  if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_COMPAT_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn("[research-worker] 警告：未检测到模型 API Key（.env.local 可能未加载）");
  } else {
    console.log("[research-worker] model credentials loaded");
  }
  await runResearchWorkerLoop({
    workerId,
    pollMs: Number(process.env.RESEARCH_WORKER_POLL_MS || 2_000),
    signal: controller.signal,
  });
  console.log(`[research-worker] stopped worker_id=${workerId}`);
}

void main().catch((error) => {
  console.error("[research-worker] fatal", error);
  process.exitCode = 1;
});
