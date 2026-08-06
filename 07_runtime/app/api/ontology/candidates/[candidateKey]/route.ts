import { reviewOntologyCandidate } from "@/05_governance/ontology_changes/candidates_adapter";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ candidateKey: string }> }) {
  try {
    const { candidateKey } = await params;
    const body = await request.json();
    const candidate = reviewOntologyCandidate({
      candidateKey: decodeURIComponent(candidateKey),
      status: body.status,
      expertName: String(body.expert_name || ""),
      decisionNote: String(body.decision_note || ""),
      targetOntologyNodeId: String(body.target_ontology_node_id || ""),
    });
    return Response.json(candidate);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
