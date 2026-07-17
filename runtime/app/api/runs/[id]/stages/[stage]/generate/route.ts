import { generateArtifact } from "@/engine/workflow"; import { STAGES } from "@/engine/types";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{id:string,stage:string}>}){try{const {id,stage}=await params;const kind=`stage_${stage.padStart(2,"0")}`;if(!STAGES.includes(kind as any))return Response.json({error:"阶段不存在"},{status:404});return Response.json(await generateArtifact(id,kind as any));}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:500});}}
