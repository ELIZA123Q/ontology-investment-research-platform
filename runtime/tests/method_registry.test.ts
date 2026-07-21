import { describe, expect, it } from "vitest";
import {
  loadMethodRegistry,
  methodRoutesForPrompt,
  validateMethodRoutes,
  validateRegisteredMethodApplications,
} from "@/engine/method_registry";
import type { MethodApplication } from "@/engine/types";

function application(overrides: Partial<MethodApplication> = {}): MethodApplication {
  return {
    application_id: "MA-01",
    method_id: "kb04:A02",
    method_version: "1.0.0",
    capability_type: "adjudication",
    target_question_refs: ["Q-01"],
    target_judgment_unit_refs: ["JU-01"],
    target_ontology_object_refs: [],
    status: "candidate",
    precondition_checks: [],
    input_evidence_refs: [],
    output_signal_refs: [],
    output_judgment_refs: [],
    execution_summary: "",
    applicability_boundary: "趋势判断",
    limitations: [],
    counter_example_refs: [],
    provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
    alternatives: [],
    ...overrides,
  };
}

describe("method registry", () => {
  it("loads structure, evidence and adjudication methods", () => {
    const registry = loadMethodRegistry();
    expect(registry.get("BF-SD-01")?.capability_type).toBe("judgment_structure");
    expect(registry.get("kb03:A03")?.method_version).toBe("3.2.0");
    expect(registry.get("kb04:A02")?.method_version).toBe("1.0.0");
    expect(registry.get("kb04:A00")?.capability_type).toBe("adjudication");
    expect(registry.get("kb03:A03")?.preconditions.length).toBeGreaterThan(0);
    expect(registry.size).toBe(43);
  });

  it("rejects unknown methods and version drift", () => {
    expect(() => validateRegisteredMethodApplications([application()])).not.toThrow();
    expect(() => validateRegisteredMethodApplications([application({ method_id: "kb04:UNKNOWN" })])).toThrow(/未登记方法/);
    expect(() => validateRegisteredMethodApplications([application({ method_version: "9.9.9" })])).toThrow(/版本不匹配/);
  });

  it("enforces judgment-type method routes", () => {
    const units = [{ id: "JU-01", judgment_type: "trend_direction" }];
    expect(() => validateMethodRoutes([application({ status: "executed" })], units)).not.toThrow();
    expect(() => validateMethodRoutes([
      application({ method_id: "kb04:A03", status: "candidate" }),
    ], units)).toThrow(/不允许用于/);
  });

  it("allows kb03:A01 as start-fact evidence for transmission_path", () => {
    const units = [{ id: "JU-02", judgment_type: "transmission_path" }];
    expect(() => validateMethodRoutes([
      application({
        application_id: "MA-JU02-EVID",
        method_id: "kb03:A01",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_judgment_unit_refs: ["JU-02"],
        status: "candidate",
      }),
    ], units)).not.toThrow();
    expect(() => validateMethodRoutes([
      application({
        application_id: "MA-JU02-EVID",
        method_id: "kb03:A02",
        method_version: "3.2.0",
        capability_type: "evidence",
        target_judgment_unit_refs: ["JU-02"],
        status: "candidate",
      }),
    ], units)).toThrow(/不允许用于/);
  });

  it("exposes compact method routes for prompts", () => {
    const routes = methodRoutesForPrompt();
    expect(routes.routes.transmission_path.allowed_kb03_methods).toEqual(
      expect.arrayContaining(["kb03:A01", "kb03:A04"]),
    );
    expect(routes.routes.transmission_path.default_kb03_method).toBe("kb03:A04");
  });

  it("keeps rejected methods route-valid and allows global A00", () => {
    const units = [{ id: "JU-01", judgment_type: "trend_direction" }];
    expect(() => validateMethodRoutes([
      application({ method_id: "kb04:A03", status: "rejected" }),
    ], units)).toThrow(/不允许用于/);
    expect(() => validateMethodRoutes([
      application({ method_id: "kb04:A00", status: "executed" }),
    ], units)).not.toThrow();
  });
});
