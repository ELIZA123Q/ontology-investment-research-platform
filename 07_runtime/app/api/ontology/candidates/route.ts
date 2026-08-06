import { listOntologyCandidates } from "@/05_governance/ontology_changes/candidates_adapter";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ candidates: listOntologyCandidates() });
}
