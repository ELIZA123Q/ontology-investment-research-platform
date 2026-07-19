import { getArtifact } from "@/adapters/db";
import { editArtifact } from "@/engine/workflow";
export const runtime="nodejs";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string;artifactId:string}>}){try{const {id,artifactId}=await params;const artifact=getArtifact(artifactId);if(!artifact||artifact.run_id!==id)return Response.json({error:"产物不存在"},{status:404});const {json_content,markdown_content}=await req.json();return Response.json(editArtifact(artifactId,json_content,markdown_content));}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
