import { getArtifact } from "@/adapters/db";
import { approve } from "@/engine/workflow";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{id:string;artifactId:string}>}){try{const {id,artifactId}=await params;const artifact=getArtifact(artifactId);if(!artifact||artifact.run_id!==id)return Response.json({error:"产物不存在"},{status:404});return Response.json(approve(artifactId));}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
