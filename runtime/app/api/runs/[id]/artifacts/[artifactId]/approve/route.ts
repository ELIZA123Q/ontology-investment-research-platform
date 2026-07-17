import { approve } from "@/engine/workflow";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{artifactId:string}>}){try{return Response.json(approve((await params).artifactId));}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
