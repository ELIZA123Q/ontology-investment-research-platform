import { applyOntologyGovernanceAction } from "@/adapters/ontology_candidates";
import type { OntologyGovernanceActionId } from "@/engine/ontology_governance";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string; actionId: string }> },
) {
  try {
    const { requestId, actionId } = await params;
    const body = await request.json();
    const changeRequest = applyOntologyGovernanceAction({
      requestId: decodeURIComponent(requestId),
      actionId: decodeURIComponent(actionId) as OntologyGovernanceActionId,
      actorName: String(body.actor_name || ""),
      actorRole: String(body.actor_role || ""),
      decisionNote: String(body.decision_note || ""),
      impactReport: body.impact_report,
      validationResults: body.validation_results,
      implementationRef: body.implementation_ref,
      breakingChange: body.breaking_change,
      migrationRef: body.migration_ref,
      migrationComplete: body.migration_complete,
      releaseFingerprint: body.release_fingerprint,
      approvalPolicySatisfied: body.approval_policy_satisfied,
      candidateFingerprint: body.candidate_fingerprint,
      remainingConflicts: body.remaining_conflicts,
    });
    return Response.json({ change_request: changeRequest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
