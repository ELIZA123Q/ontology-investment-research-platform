import { describe, expect, it } from "vitest";
import { evaluateFormalCaseEligibility, hashFormalEvidenceBundle, type FormalEvaluationCaseManifest } from "@/src/evaluation/formal-case-eligibility";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function manifest(): FormalEvaluationCaseManifest {
  const evidence = ["e1", "e2", "e3"].map((id, index) => ({
    id,
    publisherId: index === 0 ? "issuer-a" : `provider-${index}`,
    title: `冻结证据 ${index + 1}`,
    uri: `https://example.test/${id}`,
    publishedAt: `2026-0${index + 1}-15T00:00:00Z`,
    businessTime: `2025-12-${20 + index}T00:00:00Z`,
    independentSourceGroup: index === 0 ? "issuer" : `provider-${index}`,
    statementNature: index === 2 ? "interpretation" as const : "fact" as const,
    evidenceRole: "substantive" as const,
    accessStatus: "retrieved" as const,
    locator: `p.${index + 1}`,
    quote: `证据摘录 ${index + 1}`,
    contentHash: hash(String(index + 1)),
    documentAttestation: { rawContentHash: hash(String(index + 4)), byteLength: 1024 + index, mimeType: "application/pdf" },
    supports: ["c1"],
    limitations: ["仅覆盖冻结窗口"],
  }));
  return {
    schemaVersion: "1.0.0",
    caseId: "formal-case-1",
    stratum: "report_value",
    taskInput: { question: "冻结问题", subjectScope: ["半导体"], informationCutoff: "2026-04-01T00:00:00Z", allowedEndpoint: "方向性行业判断" },
    evidenceBundle: { ref: "evidence:1", hash: hashFormalEvidenceBundle(evidence), frozenAt: "2026-04-02T00:00:00Z", evidence },
    systemArtifact: { ref: "artifact:1", hash: hash("b"), frozenAt: "2026-04-03T00:00:00Z", sealedAdjudicationOpenedAt: "2026-04-04T00:00:00Z" },
    sealedAdjudication: {
      ref: "sealed:1", independenceMode: "dual_route_independent", notAReferenceReport: true, frameworkRulesUsage: "boundary_check_only",
      routeA: { modelId: "seal-a", outputHash: hash("c") }, routeB: { modelId: "seal-b", outputHash: hash("d") }, coordinator: { modelId: "seal-c", outputHash: hash("e") },
      coreClaims: [
        { claimId: "c1", statement: "方向性判断", criticality: "primary", strengthCeiling: "conditional", minimumEvidenceBasket: ["e1", "e2"] },
        { claimId: "c2", statement: "竞争解释", criticality: "supporting", strengthCeiling: "provisional", minimumEvidenceBasket: ["e2"] },
        { claimId: "c3", statement: "适用边界", criticality: "boundary", strengthCeiling: "bounded", minimumEvidenceBasket: ["e3"] },
      ],
      strongestCounterevidence: ["e3"], prohibitedExpressions: ["确定性上涨"],
      updateScenarios: [
        { id: "u1", newInformation: "删除关键证据", expectedAction: "降级", affectedClaimIds: ["c1"] },
        { id: "u2", newInformation: "新增反证", expectedAction: "争议", affectedClaimIds: ["c1", "c2"] },
      ],
      downstreamRequiredUnits: ["核心判断", "跟踪计划"],
      objectiveChecks: { numbersTimesObjectsSources: "required", minimumEvidenceExists: "required", cutoffEnforced: "required", forecastsNotFacts: "required" },
    },
    perturbations: [
      { kind: "delete_key_evidence", ref: "p:delete", hash: hash("f"), expectedAction: "降级" },
      { kind: "replace_scope_or_metric", ref: "p:scope", hash: hash("1"), expectedAction: "拒绝口径偷换" },
      { kind: "inject_counterevidence", ref: "p:counter", hash: hash("2"), expectedAction: "转为争议" },
      { kind: "move_information_cutoff", ref: "p:cutoff", hash: hash("3"), expectedAction: "过滤未来证据" },
    ],
    baselines: { sameEvidenceDirect: { ref: "baseline:direct", hash: hash("4") }, sameEvidenceSummary: { ref: "baseline:summary", hash: hash("5") } },
    evaluationModels: {
      producerModelId: "producer",
      judges: [
        { modelId: "judge-a", calibrationLevel: "C2", calibrationRef: "cal:a", calibrationHash: hash("6") },
        { modelId: "judge-b", calibrationLevel: "C3", calibrationRef: "cal:b", calibrationHash: hash("7") },
      ],
      downstream: [{ modelId: "downstream-a", role: "executor" }, { modelId: "downstream-b", role: "scorer" }],
    },
  };
}

describe("formal evaluation case eligibility", () => {
  it("issues prerequisites only after every protocol gate passes", () => {
    const result = evaluateFormalCaseEligibility(manifest());
    expect(result).toMatchObject({ status: "eligible", missingPrerequisites: [] });
    expect(result.checks.every((item) => item.passed)).toBe(true);
    expect(result.prerequisites?.eligibilityAttestation).toMatchObject({ caseId: "formal-case-1", status: "eligible" });
  });

  it("blocks future evidence, missing perturbations and non-independent models without emitting prerequisites", () => {
    const input = manifest();
    input.evidenceBundle.evidence[0].publishedAt = "2026-05-01T00:00:00Z";
    input.perturbations = input.perturbations.filter((item) => item.kind !== "inject_counterevidence");
    input.evaluationModels.downstream[0].modelId = input.evaluationModels.producerModelId;
    const result = evaluateFormalCaseEligibility(input);
    expect(result.status).toBe("not_eligible");
    expect(result.prerequisites).toBeUndefined();
    expect(result.checks.filter((item) => !item.passed).map((item) => item.id)).toEqual(expect.arrayContaining(["cutoff", "perturbations", "model_isolation"]));
  });

  it("blocks a retrieved public document when its full-file attestation is missing, malformed, or substituted by an excerpt hash", () => {
    const input = manifest();
    delete input.evidenceBundle.evidence[0].documentAttestation;
    input.evidenceBundle.evidence[1].documentAttestation!.rawContentHash = input.evidenceBundle.evidence[1].contentHash;
    input.evidenceBundle.evidence[2].documentAttestation!.mimeType = "application/octet-stream";
    input.evidenceBundle.hash = hashFormalEvidenceBundle(input.evidenceBundle.evidence);
    const result = evaluateFormalCaseEligibility(input);
    expect(result.status).toBe("not_eligible");
    expect(result.checks.find((item) => item.id === "public_document_attestation")).toMatchObject({ passed: false });
  });

  it("does not count an unavailable source as corroboration for a report-value case", () => {
    const input = manifest();
    input.evidenceBundle.evidence[1].independentSourceGroup = "issuer";
    input.evidenceBundle.evidence[2].independentSourceGroup = "datayes";
    input.evidenceBundle.evidence[2].evidenceRole = "access_gap";
    input.evidenceBundle.evidence[2].accessStatus = "unavailable";
    input.evidenceBundle.evidence[2].supports = ["boundary:independent-corroboration-missing"];
    const result = evaluateFormalCaseEligibility(input);
    expect(result.status).toBe("not_eligible");
    expect(result.checks.filter((item) => !item.passed).map((item) => item.id)).toEqual(expect.arrayContaining(["independent_sources", "stratum_evidence_boundary"]));
  });

  it("allows a restraint case to audit a real access gap without treating it as value evidence", () => {
    const input = manifest();
    input.stratum = "restraint";
    for (const item of input.evidenceBundle.evidence) item.independentSourceGroup = "htsc-research";
    input.evidenceBundle.evidence.push({
      id: "gap-datayes", publisherId: "DataYes", title: "独立实物量指标取数失败",
      uri: "mcp://datayes-macro/2090700332", publishedAt: "2026-03-20T00:00:00Z", businessTime: "2026-03-20T00:00:00Z",
      independentSourceGroup: "datayes-miit", statementNature: "fact", evidenceRole: "access_gap", accessStatus: "unavailable",
      locator: "error.code", quote: "INSUFFICIENT_CREDITS", contentHash: hash("8"), supports: ["boundary:independent-corroboration-missing"], limitations: ["没有取得指标数值"],
    });
    input.evidenceBundle.hash = hashFormalEvidenceBundle(input.evidenceBundle.evidence);
    const result = evaluateFormalCaseEligibility(input);
    expect(result.status).toBe("eligible");
    expect(result.checks.find((item) => item.id === "stratum_evidence_boundary")?.passed).toBe(true);
  });
});
