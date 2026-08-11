import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ready" | "failed" = "ready";
  const store = getRuntimeStore();
  try { store.db.prepare("SELECT 1").get(); } catch { database = "failed"; }
  const worker = database === "ready" ? store.workerHealth() : { status: "unmanaged" as const };
  const queues = database === "ready" ? store.runtimeQueueStats() : undefined;
  const akshareUrl = process.env.VNEXT_AKSHARE_URL?.trim();
  let akshare: "ready" | "degraded" | "unavailable" = akshareUrl ? "degraded" : "unavailable";
  if (akshareUrl) {
    try {
      const response = await fetch(`${akshareUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(800) });
      if (response.ok) akshare = "ready";
    } catch { /* optional connector remains degraded */ }
  }
  const status = database === "ready" && worker.status !== "stale" ? "ready" : "degraded";
  return NextResponse.json({
    service: "investment-research-copilot-vnext",
    status,
    web: "ready",
    database,
    worker,
    queues,
    connectors: { akshare },
    checkedAt: new Date().toISOString(),
  }, { status: status === "ready" ? 200 : 503 });
}
