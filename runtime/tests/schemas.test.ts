import { describe,expect,it } from "vitest";
import { taskDefinitionSchema,evidencePreparationSchema,judgmentDecisionSchema,researchExpressionSchema } from "@/engine/schemas";

describe("stage contracts",()=>{
  it("accepts a valid task definition",()=>{expect(taskDefinitionSchema.parse({normalized_question:"未来六个月供需是否改善？",core_object:"存储芯片",judgment_action:"趋势判断",time_scope:{lookback:"12个月",as_of:"当前",forward:"6个月"},boundaries:["全球"],exclusions:["交易建议"],report_type:"行业周期判断",domain_supported:true,document_markdown:"# 任务定义\n\n这是一个具有明确范围、时间和反证条件的研究问题，需要检查供给、需求、库存和价格变化。"})).toBeTruthy()});
  it("rejects evidence without sources",()=>{expect(()=>evidencePreparationSchema.parse({sources:[],evidence_drafts:[],unresolved_gaps:[],document_markdown:"# 证据准备\n\n没有来源不能形成可确认的证据草稿。"})).toThrow()});
  it("accepts J0 as an explicit judgment",()=>{expect(judgmentDecisionSchema.parse({method_selections:[{method_id:"kb04:A02",method_version:"2.1.0",purpose:"趋势裁决",selection_reason:"判断类型为趋势方向",rejected_candidate_ids:[]}],judgments:[{id:"J-1",judgment_unit_id:"JU-1",title:"当前不可判断",conclusion:"关键证据不足",rationale:"缺少直接来源",strength:"J0",supporting_evidence_draft_ids:[],counter_evidence_draft_ids:[],ontology_node_ids:["StateVariable"],uncertainties:["供给"],invalidation_conditions:["获得产能数据"],tracking_signals:["库存"]}],overall_boundary:"不外推",document_markdown:"# 判断\n\n由于关键证据不足，目前暂不可判断，不能把局部价格信号外推为全行业改善，需要继续跟踪库存和产能。"})).toBeTruthy()});
  it("requires report claim traceability",()=>{expect(()=>researchExpressionSchema.parse({title:"报告",executive_points:[],report_claims:[{id:"RC-1",statement:"结论",source_ids:[]}],limitations:[],document_markdown:"# 报告\n\n这是没有判断引用的无效报告内容。"})).toThrow()});
});
