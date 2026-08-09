import { NextResponse } from "next/server";
import type { CandidateStatus, KnowledgeScope } from "@/src/contracts";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalAdmin(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as CandidateStatus | null;
    const tenantId = url.searchParams.get("tenantId");
    const scope: KnowledgeScope | undefined = tenantId ? { kind: "tenant", tenantId } : undefined;
    const store = getRuntimeStore();
    return NextResponse.json(store.listCandidates({ status: status || undefined, scope }).map((candidate) => ({
      ...candidate,
      occurrences: store.listCandidateOccurrences(candidate.id),
      decisions: store.listCandidateDecisions(candidate.id),
      evaluationRuns: store.listEvaluationRuns(candidate.id),
    })));
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
