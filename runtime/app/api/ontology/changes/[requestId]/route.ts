import { advanceOntologyChangeRequest } from "@/adapters/ontology_candidates";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await params;
    const body = await request.json();
    const changeRequest = advanceOntologyChangeRequest({
      requestId: decodeURIComponent(requestId),
      nextStatus: body.next_status,
      actorName: String(body.actor_name || ""),
      decisionNote: String(body.decision_note || ""),
      impactReport: body.impact_report,
      validationResults: body.validation_results,
      implementationRef: body.implementation_ref,
      breakingChange: body.breaking_change,
      migrationRef: body.migration_ref,
      releaseFingerprint: body.release_fingerprint,
    });
    return Response.json({ change_request: changeRequest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
