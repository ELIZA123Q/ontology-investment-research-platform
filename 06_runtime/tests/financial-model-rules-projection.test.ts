import { describe, expect, it } from "vitest";
import { FINANCIAL_MODEL_RULES } from "@/src/research/generated/financial-model-rules";

describe("governed financial-model rule projection", () => {
  it("exposes the authored control policy instead of maintaining runtime-only financial thresholds", () => {
    expect(FINANCIAL_MODEL_RULES.schema_name).toBe("financial_model_integrity_policy");
    expect(FINANCIAL_MODEL_RULES.governance.source_of_truth).toBe("05_control_evaluation/01_rules/policies/financial_model_integrity_policy.yaml");
    expect(FINANCIAL_MODEL_RULES.reconciliations.map((rule) => rule.id)).toEqual(["balance_sheet_equation", "cash_flow_rollforward"]);
    expect(FINANCIAL_MODEL_RULES.unit_normalization.monetary.supported.CNY["万元"]).toBe(10_000);
    expect(FINANCIAL_MODEL_RULES.valuation_gate.required_model_scope).toBe("forecast_model");
  });
});
