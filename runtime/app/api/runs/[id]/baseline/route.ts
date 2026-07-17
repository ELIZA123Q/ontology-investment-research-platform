import { generateArtifact } from "@/engine/workflow";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await generateArtifact((await params).id,"baseline"));}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:500});}}
