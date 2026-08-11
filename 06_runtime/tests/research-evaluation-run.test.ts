import { describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";
import { prepareResearchEvaluationRun } from "@/src/evaluation/research-evaluation-run";
import type { FormalEvaluationCaseManifest } from "@/src/evaluation/formal-case-eligibility";

const h = (value: string) => `sha256:${value.repeat(64)}`;
const manifest = (): FormalEvaluationCaseManifest => ({
  schemaVersion: "1.0.0", caseId: "eval-run-case", stratum: "restraint",
  taskInput: { question: "是否足以判断转弱", subjectScope: ["半导体"], informationCutoff: "2026-08-11T02:45:00Z", allowedEndpoint: "暂不可判断" },
  evidenceBundle: { ref: "case://evidence", hash: h("a"), frozenAt: "2026-08-11T02:46:00Z", evidence: [] },
  systemArtifact: { ref: "", hash: "", frozenAt: "", sealedAdjudicationOpenedAt: "" },
  sealedAdjudication: { ref: "", independenceMode: "pilot_manual", notAReferenceReport: true, frameworkRulesUsage: "boundary_check_only", routeA: { modelId: "", outputHash: "" }, routeB: { modelId: "", outputHash: "" }, coordinator: { modelId: "", outputHash: "" }, coreClaims: [], strongestCounterevidence: [], prohibitedExpressions: [], updateScenarios: [], downstreamRequiredUnits: [], objectiveChecks: { numbersTimesObjectsSources: "required", minimumEvidenceExists: "required", cutoffEnforced: "required", forecastsNotFacts: "required" } },
  perturbations: [], baselines: { sameEvidenceDirect: { ref: "", hash: "" }, sameEvidenceSummary: { ref: "", hash: "" } }, evaluationModels: { producerModelId: "", judges: [], downstream: [] },
});

describe("research evaluation run persistence", () => {
  it("persists frozen system/baseline artifacts while refusing to claim formal eligibility prematurely", () => {
    const store = new RuntimeStore(":memory:");
    try {
      const prepared = prepareResearchEvaluationRun(store, {
        manifest: manifest(),
        systemArtifact: { ref: "artifact:system@1", payload: { conclusion: "暂不可判断", facts: ["e1"] }, frozenAt: "2026-08-11T02:47:00Z", modelId: "system-model" },
        baselines: [
          { ref: "baseline:direct@1", payload: { answer: "直接问答" }, frozenAt: "2026-08-11T02:48:00Z", modelId: "baseline-a" },
          { ref: "baseline:summary@1", payload: { answer: "摘要基线" }, frozenAt: "2026-08-11T02:48:01Z", modelId: "baseline-b" },
        ],
      });
      expect(prepared.run).toMatchObject({ status: "prepared", formalScoreEligible: false, baselineArtifacts: [{ track: "direct_qa" }, { track: "evidence_summary" }] });
      expect(prepared.formalEligibility.status).toBe("not_eligible");
      expect(prepared.run.notes.join(" ")).toContain("formal eligibility pending");
      expect(store.listResearchEvaluationRuns("eval-run-case")).toEqual([expect.objectContaining({ id: prepared.run.id, systemArtifact: expect.objectContaining({ artifactHash: prepared.systemArtifactHash }) })]);
    } finally { store.close(); }
  });

  it("marks a run invalid if system output predates its frozen evidence", () => {
    const store = new RuntimeStore(":memory:");
    try {
      const prepared = prepareResearchEvaluationRun(store, {
        manifest: manifest(),
        systemArtifact: { ref: "artifact:system@1", payload: {}, frozenAt: "2026-08-11T02:45:59Z" },
        baselines: [{ ref: "baseline:direct@1", payload: {}, frozenAt: "2026-08-11T02:48:00Z" }, { ref: "baseline:summary@1", payload: {}, frozenAt: "2026-08-11T02:48:00Z" }],
      });
      expect(prepared.run.status).toBe("invalid");
    } finally { store.close(); }
  });
});
