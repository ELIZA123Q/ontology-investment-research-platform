import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { ResearchSignalCandidate, SignalRefreshRun } from "@/src/contracts";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = Buffer.from(process.env.VNEXT_INTERNAL_CONNECTOR_TOKEN?.trim() || "");
  const actual = Buffer.from(request.headers.get("x-vnext-connector-token") || "");
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized connector callback" }, { status: 401 });
  const store = getRuntimeStore();
  try {
    const body = await request.json() as {
      runId: string;
      status: Extract<SignalRefreshRun["status"], "completed" | "partial" | "failed">;
      error?: string;
      candidates?: Array<Omit<ResearchSignalCandidate, "id" | "status" | "promotedTaskId"> & { content: string }>;
    };
    if (!store.getSignalRefreshRun(body.runId)) return NextResponse.json({ error: "Unknown refresh run" }, { status: 404 });
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 1000) : [];
    const candidateCount = store.upsertSignalCandidates(candidates);
    return NextResponse.json(store.updateSignalRefreshRun(body.runId, { status: body.status, candidateCount, error: body.error }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
