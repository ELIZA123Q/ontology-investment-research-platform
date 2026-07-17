import { loadOntology } from "@/adapters/ontology";
export const runtime="nodejs";
export async function GET(){return Response.json({nodes:loadOntology()});}
