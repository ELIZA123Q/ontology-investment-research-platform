import { latestArtifact, listSources } from "@/adapters/db";
import { appendReportClaimSourceIndex } from "@/engine/report_source_index";
import { parseJson } from "@/engine/types";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const id=(await params).id;
  const a=latestArtifact(id,"stage_05",["approved"]);
  if(!a)return Response.json({error:"报告尚未批准，不能作为正式报告下载"},{status:404});
  const markdown=appendReportClaimSourceIndex(a.markdown_content,parseJson(a.json_content,{}),listSources(id));
  return new Response(markdown,{headers:{"content-type":"text/markdown; charset=utf-8","content-disposition":"attachment; filename=research-report.md"}});
}
