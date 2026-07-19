import { latestArtifact } from "@/adapters/db";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const a=latestArtifact((await params).id,"stage_05",["approved"]);return a?new Response(a.markdown_content,{headers:{"content-type":"text/markdown; charset=utf-8","content-disposition":"attachment; filename=research-report.md"}}):Response.json({error:"报告尚未批准，不能作为正式报告下载"},{status:404});}
