import { promoteOntologyCandidateGroup } from "@/adapters/ontology_candidates";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ candidateKey: string }> }) {
  try {
    const { candidateKey } = await params;
    const body = await request.json();
    const candidate = promoteOntologyCandidateGroup({
      candidateKey: decodeURIComponent(candidateKey),
      memberCandidateKeys: Array.isArray(body.member_candidate_keys) ? body.member_candidate_keys.map(String) : [],
      expertName: String(body.expert_name || ""),
      decisionNote: String(body.decision_note || ""),
      definition: {
        targetId: String(body.target_ontology_node_id || ""),
        name: String(body.name || ""),
        definition: String(body.definition || ""),
        category: String(body.category || ""),
        variableKind: String(body.variable_kind || ""),
        anchors: Array.isArray(body.anchors) ? body.anchors.map(String) : [],
        evidenceProfileRef: String(body.evidence_profile_ref || ""),
        decisionUse: String(body.decision_use || ""),
        observationGuidance: String(body.observation_guidance || ""),
        counterEvidenceGuidance: String(body.counter_evidence_guidance || ""),
      },
    });
    return Response.json({ candidate });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
