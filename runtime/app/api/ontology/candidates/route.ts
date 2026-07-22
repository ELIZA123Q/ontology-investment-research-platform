import { listOntologyCandidates } from "@/adapters/ontology_candidates";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ candidates: listOntologyCandidates() });
}
