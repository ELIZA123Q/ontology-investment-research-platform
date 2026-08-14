import { describe, expect, it } from "vitest";
import { MODEL_DATA_EGRESS_RULES } from "@/src/providers/generated/model-data-egress-rules";

describe("governed model data-egress rule projection", () => {
  it("uses the authored permission mapping and local-only restricted boundary", () => {
    expect(MODEL_DATA_EGRESS_RULES.schema_name).toBe("model_data_egress_policy");
    expect(MODEL_DATA_EGRESS_RULES.governance.source_of_truth).toBe("05_control_evaluation/01_rules/policies/model_data_egress_policy.yaml");
    expect(MODEL_DATA_EGRESS_RULES.source_permission_mapping.missing_permission_scope).toBe("restricted_no_egress");
    expect(MODEL_DATA_EGRESS_RULES.aggregation.precedence).toEqual(["restricted_no_egress", "private_authorized", "public"]);
    expect(MODEL_DATA_EGRESS_RULES.policies.restricted_no_egress.allowed_provider_deployments).toEqual(["local"]);
  });
});
