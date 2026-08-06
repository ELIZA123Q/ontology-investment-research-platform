import { describe, expect, it } from "vitest";
import {
  allowedOntologyChangeTransitions,
  assertOntologyGovernanceAction,
  assertOntologyChangeTransition,
  governanceActionDefinition,
  ontologyGovernanceActionForTransition,
} from "@/skills/ontology/governance";

const impact = {
  changed_element_ids: ["depreciation_intensity"],
  affected_consumers: ["runtime_semantic_catalog"],
  affected_run_ids: [],
  required_checks: ["validate_v3", "ontology:check"],
};

describe("ontology governance lifecycle", () => {
  it("loads states, transitions and action-log policy from the governance ontology YAML", () => {
    expect(ontologyGovernanceActionForTransition("proposed", "impact_assessed")).toBe("FreezeImpactAssessment");
    expect(governanceActionDefinition("ReleaseOntologyBaseline").action_log).toEqual({
      object_type: "GovernanceActionLog",
      version: "2.0.0",
      immutable: true,
    });
  });

  it("requires the full proposal-to-release path", () => {
    expect(allowedOntologyChangeTransitions("proposed")).toEqual(["impact_assessed", "rejected"]);
    expect(() => assertOntologyChangeTransition("proposed", "approved", {})).toThrow(/不得/);
    expect(() => assertOntologyChangeTransition("proposed", "impact_assessed", { impact_report: impact })).not.toThrow();
    expect(() => assertOntologyChangeTransition("approved", "implemented", {
      implementation_ref: "01_semantic/01_ontology/domains/semiconductor/business_instances.yaml",
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

  it("typed approval action enforces baseline freshness and approval policy", () => {
    const fingerprint = `sha256:${"b".repeat(64)}`;
    expect(() => assertOntologyGovernanceAction("ApproveOntologyChange", "impact_assessed", {
      base_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
      approval_policy_satisfied: false,
    })).toThrow(/批准策略/);
    expect(() => assertOntologyGovernanceAction("ApproveOntologyChange", "impact_assessed", {
      base_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
      approval_policy_satisfied: true,
      unresolved_conflicts: ["conflict-1"],
    })).toThrow(/rebase/);
  });

  it("requires a resolved target, current fingerprint and migration for breaking releases", () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const validatedEvidence = {
      required_checks: impact.required_checks,
      validation_results: { validate_v3: "pass", "ontology:check": "pass" } as const,
    };
    expect(() => assertOntologyChangeTransition("validated", "released", {
      ...validatedEvidence,
      target_resolves: false,
      release_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
    })).toThrow(/必须能从当前本体/);
    expect(() => assertOntologyChangeTransition("validated", "released", {
      ...validatedEvidence,
      target_resolves: true,
      release_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
      breaking_change: true,
    })).toThrow(/迁移任务/);
    expect(() => assertOntologyChangeTransition("validated", "released", {
      ...validatedEvidence,
      target_resolves: true,
      release_fingerprint: fingerprint,
      current_ontology_fingerprint: fingerprint,
      breaking_change: true,
      migration_ref: "90_compat/ontology/03_迁移/change-001.yaml",
    })).not.toThrow();
  });
});
