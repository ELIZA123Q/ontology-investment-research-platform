import { NextResponse } from "next/server";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertInternalAdmin(request);
    const { id } = await context.params;
    const store = getRuntimeStore();
    const candidate = store.getCandidate(id);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    const revision = store.getAssetRevision(candidate.proposedRevisionId);
    const lock = store.getKnowledgeLock(candidate.taskId);
    const runBaselineRef = lock?.assetRefs.find((ref) => ref.kind === candidate.assetKind && ref.identityKey === candidate.identityKey);
    const currentRef = store.getReleasedAssetByIdentity(candidate.identityKey, candidate.assetKind, candidate.scope);
    return NextResponse.json({
      candidate,
      revision,
      knowledgeLock: lock,
      threeWayDiff: {
        runBaseline: runBaselineRef ? store.getAssetRevisionByRef(runBaselineRef) || runBaselineRef : null,
        currentBaseline: currentRef ? store.getAssetRevisionByRef(currentRef) || currentRef : null,
        candidateRevision: revision,
      },
      occurrences: store.listCandidateOccurrences(id),
      similarCandidates: store.findCandidatesByIdentity(candidate.identityKey, candidate.assetKind).filter((item) => item.id !== id),
      decisions: store.listCandidateDecisions(id),
      evaluationRuns: store.listEvaluationRuns(id),
      currentRelease: store.getCurrentRelease(candidate.scope),
      lineage: store.assetLineage(revision?.assetId || candidate.targetAssetRef?.assetId || ""),
    });
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
