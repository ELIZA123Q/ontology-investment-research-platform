import { ontologyCatalog } from "@/src/ontology/catalog";

export class OntologyFunctionService {
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
        return { sufficient: refs.length > 0, qualifiedEvidenceCount: refs.length, rationale: refs.length ? "存在已核验证据引用。" : "没有已核验证据。" };
      }
      case "GenerateHypothesisCandidates": {
        const statement = String(input.statement || "").trim();
        return { hypothesisCandidates: statement ? [{ statement, falsificationConditions: [], status: "candidate" }] : [] };
      }
      case "ComputeJudgmentProposal": {
        const evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(Boolean) : [];
        return { judgmentProposal: { statement: String(input.statement || "暂不可判断"), epistemicStatus: evidenceRefs.length ? "supported" : "indeterminate", lifecycleStatus: "proposed", confidence: evidenceRefs.length ? "medium" : "insufficient", evidenceRefs } };
      }
      default:
        throw new Error(`No implementation for Ontology function: ${functionType}`);
    }
  }
}

