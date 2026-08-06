import { describe, expect, it } from "vitest";
import {
  adaptArtifactForRead,
  projectClaimsFromJudgments,
  projectExpressionsFromReportClaims,
  stripLegacyWriteFields,
  toExpressionAuditInputs,
} from "../skills/semantic_review/artifact_read_adapter";

describe("artifact read adapter", () => {
  it("maps Stage02 formal path aliases without guessing missing bindings", () => {
    const stage02 = adaptArtifactForRead("stage_02", {
      judgment_units: [{
        judgment_unit_id: "JU-1",
        statement: "价格路径判断",
        path_refs: ["P-1"],
      }],
      paths: [{
        path_id: "P-1",
        description: "需求传导至价格",
        state_variable_refs: ["SV-1", "SV-2"],
      }],
    });
    expect(stage02.paths[0]).toMatchObject({
      id: "P-1",
      variable_ids: ["SV-1", "SV-2"],
      judgment_unit_ids: ["JU-1"],
    });
  });

  it("projects claims from judgments with C-nn ids", () => {
    const claims = projectClaimsFromJudgments([
      {
        id: "J-1",
        conclusion: "库存正在改善",
        strength: "J2",
        supporting_evidence_draft_ids: ["EV-1"],
        method_application_ids: ["MA-1"],
        scope_ref: "RS-1",
      },
    ]);
    expect(claims).toEqual([expect.objectContaining({
      id: "C-01",
      judgment_id: "J-1",
      statement: "库存正在改善",
      strength: "J2",
      evidence_refs: ["EV-1"],
    })]);
  });

  it("maps legacy stage04/05 fields for read without rewriting persistence", () => {
    const stage04 = adaptArtifactForRead("stage_04", {
      judgments: [{
        id: "J-1",
        judgment_unit_ref: "JU-1",
        conclusion: "方向观察成立",
        level: "J1",
        evidence_draft_ids: ["EV-9"],
      }],
    });
    expect(stage04.judgments[0].judgment_unit_id).toBe("JU-1");
    expect(stage04.judgments[0].strength).toBe("J1");
    expect(stage04.judgments[0].supporting_evidence_draft_ids).toEqual(["EV-9"]);
    expect(stage04.claims[0].id).toBe("C-01");

    const stage05 = adaptArtifactForRead("stage_05", {
      report_claims: [{
        id: "RC-1",
        statement: "报告主张",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-1"],
        evidence_draft_ids: ["EV-9"],
        source_ids: ["SRC-1"],
      }],
    });
    expect(stage05.expressions[0]).toMatchObject({
      id: "EX-01",
      claim_id: "RC-1",
      statement: "报告主张",
      judgment_ids: ["J-1"],
    });
  });

  it("builds expression audit inputs from report_claims + projected claims", () => {
    const inputs = toExpressionAuditInputs(
      {
        report_claims: [{
          id: "RC-1",
          statement: "可观察的改善",
          judgment_ids: ["J-1"],
          method_application_ids: ["MA-1"],
          evidence_draft_ids: [],
          source_ids: [],
        }],
      },
      {
        judgments: [{
          id: "J-1",
          conclusion: "库存改善",
          strength: "J1",
          supporting_evidence_draft_ids: ["EV-1"],
        }],
      },
    );
    expect(inputs.claims[0].id).toBe("C-01");
    expect(inputs.expressions[0].claim_id).toBe("C-01");
    expect(inputs.expressions[0].text).toBe("可观察的改善");
  });

  it("strips legacy write fields so they cannot re-enter artifacts", () => {
    const cleaned = stripLegacyWriteFields({
      title: "ok",
      report_claims: [],
      expressions: [{ id: "EX-1" }],
      expression_audit: { failed: 1 },
      admission: "PUBLISHABLE",
    });
    expect(cleaned.title).toBe("ok");
    expect(cleaned.expressions).toBeUndefined();
    expect(cleaned.expression_audit).toBeUndefined();
    expect(cleaned.admission).toBeUndefined();
  });

  it("projects expressions from report claims", () => {
    const expressions = projectExpressionsFromReportClaims(
      [{ id: "RC-1", statement: "正文主张", judgment_ids: ["J-1"], method_application_ids: [], evidence_draft_ids: [], source_ids: [] }],
      [{ id: "C-01", judgment_id: "J-1", statement: "库存改善", strength: "J1", evidence_refs: [], method_application_ids: [], scope_ref: "" }],
    );
    expect(expressions[0].claim_id).toBe("C-01");
  });
});
