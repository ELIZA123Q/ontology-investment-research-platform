import { listOntologyChangeRequests } from "@/adapters/ontology_candidates";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ change_requests: listOntologyChangeRequests() });
}
