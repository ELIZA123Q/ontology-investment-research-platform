import { describe, expect, it } from "vitest";
import {
  allowedOntologyChangeTransitions,
  assertOntologyChangeTransition,
} from "@/engine/ontology_governance";

const impact = {
  changed_element_ids: ["depreciation_intensity"],
  affected_consumers: ["runtime_semantic_catalog"],
  affected_run_ids: [],
  required_checks: ["validate_v3", "ontology:check"],
};

describe("ontology governance lifecycle", () => {
  it("requires the full proposal-to-release path", () => {
    expect(allowedOntologyChangeTransitions("proposed")).toEqual(["impact_assessed", "rejected"]);
    expect(() => assertOntologyChangeTransition("proposed", "approved", {})).toThrow(/不得/);
    expect(() => assertOntologyChangeTransition("proposed", "impact_assessed", { impact_report: impact })).not.toThrow();
    expect(() => assertOntologyChangeTransition("approved", "implemented", {
      implementation_ref: "ontology/02_领域/semiconductor/business_instances.yaml",
    })).not.toThrow();
  });

  it("cannot validate while a required check is missing or failed", () => {
    expect(() => assertOntologyChangeTransition("implemented", "validated", {
      required_checks: impact.required_checks,
      validation_results: { validate_v3: "pass", "ontology:check": "fail" },
    })).toThrow(/未通过检查/);
    expect(() => assertOntologyChangeTransition("implemented", "validated", {
      required_checks: impact.required_checks,
      validation_results: { validate_v3: "pass", "ontology:check": "pass" },
    })).not.toThrow();
  });

  it("requires a resolved target, current fingerprint and migration for breaking releases", () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    expect(() => assertOntologyChangeTransition("validated", "released", {
      target_resolves: false,
      release_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
    })).toThrow(/必须能从当前本体/);
    expect(() => assertOntologyChangeTransition("validated", "released", {
      target_resolves: true,
      release_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
      breaking_change: true,
    })).toThrow(/迁移记录/);
    expect(() => assertOntologyChangeTransition("validated", "released", {
      target_resolves: true,
      release_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
      breaking_change: true,
      migration_ref: "ontology/03_迁移/change-001.yaml",
    })).not.toThrow();
  });
});
