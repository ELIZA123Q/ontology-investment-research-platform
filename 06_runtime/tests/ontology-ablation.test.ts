import { describe, expect, it } from "vitest";
import { evaluateOntologyAblation, type OntologyAblationCase } from "@/src/evaluation/ontology-ablation";

function cases(count = 12): OntologyAblationCase[] {
  return Array.from({ length: count }, (_, index) => ({
    caseId: `case-${index + 1}`,
    evidenceBundleHashP1: `sha256:${String(index).padStart(64, "0")}`,
    evidenceBundleHashP2: `sha256:${String(index).padStart(64, "0")}`,
    p1: { judgmentOmissionRate: 0.2, sourceErrorRate: 0.1, basisDriftRate: 0.1, manualInterventions: 3, latencyMs: 1000, costUsd: 1, researcherUtility: 3 },
    p2: { judgmentOmissionRate: 0.1, sourceErrorRate: 0.05, basisDriftRate: 0.1, manualInterventions: 2, latencyMs: 1100, costUsd: 1.1, researcherUtility: 4 },
    blinded: true,
    humanReviewed: true,
  }));
}

describe("ontology P1/P2 ablation gate", () => {
  it("requires twelve same-evidence blind human-reviewed pairs and two core improvements", () => {
    const result = evaluateOntologyAblation(cases());
    expect(result.status).toBe("ready_for_release_review");
    expect(result.improvedCoreMetrics).toEqual(expect.arrayContaining(["judgmentOmissionRate", "sourceErrorRate", "manualInterventions"]));
  });

  it("keeps unmatched or unreviewed pairs out of formal release", () => {
    const input = cases(11);
    input[0].evidenceBundleHashP2 = "sha256:different";
    input[1].humanReviewed = false;
    expect(evaluateOntologyAblation(input).status).toBe("invalid");
  });
});
