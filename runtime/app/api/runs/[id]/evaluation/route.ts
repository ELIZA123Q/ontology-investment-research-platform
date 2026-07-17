import { createArtifact, latestArtifact } from "@/adapters/db";
import { evaluationSchema } from "@/engine/schemas";
export const runtime="nodejs";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{const runId=(await params).id;const value=evaluationSchema.parse(await req.json());const artifact=createArtifact(runId,"evaluation",{status:"approved",json_content:JSON.stringify(value,null,2),markdown_content:`# A/B 评价\n\n${Object.entries(value.scores).map(([k,v])=>`- ${k}: ${v}/5`).join("\n")}\n\n${value.notes}`,approved_at:new Date().toISOString()});return Response.json(artifact);}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
