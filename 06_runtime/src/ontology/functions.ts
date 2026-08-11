import { ontologyCatalog } from "@/src/ontology/catalog";
import { OntologyQueryService } from "@/src/ontology/query-service";
import { OntologyStore } from "@/src/ontology/store";

export const ONTOLOGY_FUNCTION_HANDLERS = new Set([
  "ExtractClaims", "NormalizeClaimValue", "AssessEvidenceUsability", "GenerateHypothesisCandidates", "ComputeJudgmentProposal",
  "SuggestResearchLenses", "AssembleResearchRequirements", "NormalizeFinancialObservation", "ComputeValuationScenario", "CompareExpectationGap",
]);

export class OntologyFunctionService {
  constructor(private readonly ontology?: OntologyStore, private readonly query?: OntologyQueryService) {}

  execute(functionType: string, input: Record<string, unknown>): Record<string, unknown> {
    ontologyCatalog.getFunctionType(functionType);
    switch (functionType) {
      case "ExtractClaims": {
        const content = String(input.content || "").trim();
        const claimCandidates = content ? content.split(/[。；\n]+/).map((statement) => statement.trim()).filter(Boolean).map((statement) => ({ statement })) : [];
        return { claimCandidates };
      }
      case "NormalizeClaimValue":
        return { normalizedClaim: { statement: String(input.statement || "").trim(), semanticRefs: input.semanticRefs || [], unit: input.unit, businessTime: input.businessTime } };
      case "AssessEvidenceUsability": {
        const refs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(Boolean) : [];
        const verified = this.ontology ? refs.filter((id) => this.ontology!.getObject(String(id))?.properties.verification_status === "verified") : refs;
        return { sufficient: verified.length > 0, qualifiedEvidenceCount: verified.length, rationale: verified.length ? "存在已核验且可追溯的证据引用。" : "没有已核验证据。" };
      }
      case "GenerateHypothesisCandidates": {
        const statement = String(input.statement || "").trim();
        return { hypothesisCandidates: statement ? [{ statement, falsificationConditions: [], status: "candidate" }] : [] };
      }
      case "ComputeJudgmentProposal": {
        const evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(Boolean) : [];
        return { judgmentProposal: { statement: String(input.statement || "暂不可判断"), epistemicStatus: evidenceRefs.length ? "supported" : "indeterminate", lifecycleStatus: "proposed", confidence: evidenceRefs.length ? "medium" : "insufficient", evidenceRefs } };
      }
      case "SuggestResearchLenses": {
        const goal = String(input.goal || "").toLowerCase();
        const available = Array.isArray(input.availableLensRefs) ? input.availableLensRefs.map(String) : ontologyCatalog.listLensProfiles().map((item) => item.id);
        const keywordMap: Array<[string, string[]]> = [
          ["value_valuation", ["估值", "估价", "倍数", "现金流", "价值"]], ["quality", ["质量", "现金流", "治理", "roe"]],
          ["growth", ["增长", "渗透", "放量", "收入"]], ["cycle", ["周期", "景气", "库存", "供需"]],
          ["event_driven", ["事件", "公告", "政策", "财报", "业绩"]], ["expectation_gap", ["预期差", "一致预期", "超预期", "计价"]],
          ["risk_first", ["风险", "压力", "下行", "反证"]],
        ];
        const suggested = keywordMap.filter(([id, words]) => available.includes(id) && words.some((word) => goal.includes(word))).map(([id]) => id);
        const lensRefs = suggested.length ? suggested : available.includes("fundamental") ? ["fundamental"] : available.slice(0, 1);
        return { suggestions: lensRefs.map((id) => ({ id, ...ontologyCatalog.getLensProfile(id), reason: suggested.includes(id) ? "研究目标关键词匹配" : "权益研究默认基本面视角" })) };
      }
      case "AssembleResearchRequirements": {
        const lensRefs = Array.isArray(input.lensRefs) ? input.lensRefs.map(String) : [];
        const profiles: Array<Record<string, unknown>> = lensRefs.map((id) => ({ id, ...ontologyCatalog.getLensProfile(id) }));
        return { requirements: {
          lensRefs, profiles,
          evidenceRoles: [...new Set(profiles.flatMap((profile) => Array.isArray(profile.evidence_roles) ? profile.evidence_roles.map(String) : []))],
          requiredInterfaces: [...new Set(profiles.flatMap((profile) => Array.isArray(profile.required_interfaces) ? profile.required_interfaces.map(String) : []))],
          stopConditions: [...new Set(profiles.flatMap((profile) => Array.isArray(profile.stop_conditions) ? profile.stop_conditions.map(String) : []))],
        } };
      }
      case "NormalizeFinancialObservation": {
        const observation = input.observation && typeof input.observation === "object" ? input.observation as Record<string, unknown> : {};
        const value = observation.value && typeof observation.value === "object" ? observation.value : { value: observation.value, unit: observation.unit };
        return { normalizedObservation: { ...observation, metricRef: input.metricRef, value, normalizationStatus: "normalized", source: this.query ? "ontology_object_set" : "input_only" } };
      }
      case "ComputeValuationScenario": {
        const forecasts = Array.isArray(input.forecastRefs) ? input.forecastRefs.map(String) : [];
        const assumptions = Array.isArray(input.assumptionRefs) ? input.assumptionRefs.map(String) : [];
        return { valuationScenario: { method: String(input.method || "relative_multiple"), forecastRefs: forecasts, assumptionRefs: assumptions, eligible: forecasts.length > 0 && assumptions.length > 0, limitations: forecasts.length && assumptions.length ? [] : ["需要已审计预测和可证伪假设"], nonTrading: true } };
      }
      case "CompareExpectationGap": {
        const forecast = this.ontology?.getObject(String(input.forecastRef || ""));
        const consensus = this.ontology?.getObject(String(input.consensusRef || ""));
        const comparable = Boolean(forecast && consensus && forecast.type === "Forecast" && consensus.type === "ConsensusSnapshot" && String(forecast.properties.metric_ref) === String(consensus.properties.metric_ref));
        return { expectationGap: { comparable, forecastRef: input.forecastRef, consensusRef: input.consensusRef, reason: comparable ? "指标与对象口径可比较" : "缺少同对象同指标的冻结共识快照" } };
      }
      default:
        throw new Error(`No implementation for Ontology function: ${functionType}`);
    }
  }
}
