import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertSignalCandidateAccess, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const store = getRuntimeStore();
  try {
    const { id } = await context.params;
    const body = await request.json() as { decision?: "seen" | "dismissed" | "use_in_research" };
    const candidate = assertSignalCandidateAccess(store, request, id);
    if (body.decision === "seen" || body.decision === "dismissed") return NextResponse.json(store.decideSignalCandidate(id, body.decision));
    if (body.decision !== "use_in_research") return NextResponse.json({ error: "Unknown decision" }, { status: 400 });

    const kernel = new AgentKernel(store);
    const latest = store.getLatestTask(candidate.conversationId);
    if (!latest) return NextResponse.json({ error: "Start a research task before promoting this signal" }, { status: 409 });
    const allowed = new Set(["planned", "queued", "waiting_input", "waiting_approval", "failed"]);
    const target = allowed.has(latest.status) ? latest : kernel.branchTask(latest.id, `只补充并核验以下新材料：${candidate.title}`);
    const content = candidate.content.trim() || candidate.excerpt.trim() || candidate.title;
    const quote = content.includes(candidate.excerpt.trim()) && candidate.excerpt.trim() ? candidate.excerpt.trim() : content;
    const artifact = kernel.ingestExternalSource(target.id, {
      connectorId: candidate.connectorId,
      operation: candidate.kind === "announcement" ? "stock_notice_report" : "stock_news_em",
      requestParameters: { signalCandidateId: candidate.id, fingerprint: candidate.fingerprint },
      requestedAt: candidate.capturedAt,
      retrievedAt: candidate.capturedAt,
      upstream: {
        sourceId: candidate.fingerprint,
        uri: candidate.sourceUri,
        title: candidate.title,
        publisherId: candidate.publisher,
        publishedAt: candidate.publishedAt,
        sourceType: candidate.sourceType,
      },
      capture: {
        body: content,
        locator: `${candidate.kind === "announcement" ? "公告" : "新闻"}候选材料；匹配原因：${candidate.matchReason}`,
        quote,
        permissionScope: "public_research_use",
      },
    });
    return NextResponse.json({ candidate: store.decideSignalCandidate(id, "promoted", target.id), task: target, artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
