import type { Artifact,SourceRecord } from "./types";import { parseJson } from "./types";
const usage=(a:Artifact)=>parseJson<any>(a.token_usage,{});
export function comparisonMetrics(baseline:Artifact,report:Artifact,stage03:Artifact|undefined,stage04:Artifact|undefined,sources:SourceRecord[]){
 const b:any=parseJson(baseline.json_content,{}),r:any=parseJson(report.json_content,{}),e:any=parseJson(stage03?.json_content||"{}",{}),j:any=parseJson(stage04?.json_content||"{}",{});
 const bClaims=b.core_claims||[],rClaims=r.report_claims||[],judgments=j.judgments||[];
 const tokens=(a:Artifact)=>{const u=usage(a);return (u.input_tokens||0)+(u.output_tokens||0)};
 return {
  baseline:{clickable_sources:(b.sources||[]).length,supported_claim_ratio:bClaims.length?bClaims.filter((x:any)=>x.source_keys?.length).length/bClaims.length:0,counterevidence_count:(b.counterpoints||[]).length,limitations_count:(b.limitations||[]).length,tokens:tokens(baseline),web_search_calls:parseJson<any>(baseline.tool_usage,{}).web_search_calls||0},
  runtime:{clickable_sources:sources.length,supported_claim_ratio:rClaims.length?rClaims.filter((x:any)=>x.source_ids?.length&&x.judgment_ids?.length).length/rClaims.length:0,counterevidence_count:judgments.reduce((n:number,x:any)=>n+(x.counter_evidence_draft_ids?.length||0),0),limitations_count:(r.limitations||[]).length+judgments.reduce((n:number,x:any)=>n+(x.invalidation_conditions?.length||0),0),traceable_claim_ratio:rClaims.length?rClaims.filter((x:any)=>x.judgment_ids?.length).length/rClaims.length:0,evidence_drafts:(e.evidence_drafts||[]).length,tokens:tokens(report),web_search_calls:parseJson<any>(stage03?.tool_usage||"{}",{}).web_search_calls||0}
 };
}
