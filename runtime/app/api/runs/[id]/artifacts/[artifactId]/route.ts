import { editArtifact } from "@/engine/workflow";
export const runtime="nodejs";
export async function PATCH(req:Request,{params}:{params:Promise<{artifactId:string}>}){try{const {json_content,markdown_content}=await req.json();return Response.json(editArtifact((await params).artifactId,json_content,markdown_content));}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
