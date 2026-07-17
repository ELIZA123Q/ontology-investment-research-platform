import { ontologyInstances } from "@/adapters/ontology";
export const runtime="nodejs";
export async function GET(req:Request,{params}:{params:Promise<{nodeId:string}>}){const runId=new URL(req.url).searchParams.get("runId");if(!runId)return Response.json({error:"缺少 runId"},{status:400});return Response.json(ontologyInstances((await params).nodeId,runId));}
