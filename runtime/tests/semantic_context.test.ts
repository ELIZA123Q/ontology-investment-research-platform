import { describe, expect, it } from "vitest";
import { buildStageSemanticContext, validateStageSemanticContext } from "@/engine/semantic_context";

describe("stage semantic context", () => {
  it("records formal ontology fingerprint and resolves task object references", () => {
    const context = buildStageSemanticContext({
      stage: "stage_02",
      data: {
        research_scope: { id: "SCOPE-1" },
        variables: [{
          id: "SV-1",
          ontology_node_id: "task_local:SV-1",
        }],
        judgment_units: [{
          id: "JU-1",
          scope_ref: "SCOPE-1",
          ontology_node_ids: ["SV-1", "task_local:SV-1"],
        }],
        method_applications: [{
          application_id: "MA-1",
          target_judgment_unit_refs: ["JU-1"],
          target_ontology_object_refs: ["SV-1"],
        }],
      },
    });

    expect(context.ontology_versions).toContain("3.0.0");
    expect(context.ontology_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(context.resolution_status).toBe("complete");
    expect(context.reference_coverage).toBe(1);
    expect(context.task_local_ids).toEqual(["task_local:SV-1"]);
  });

  it("surfaces unresolved semantic references without coercing them", () => {
    const context = buildStageSemanticContext({
      stage: "stage_03",
      data: {
        evidence_drafts: [{
          id: "EV-1",
          judgment_unit_ids: ["JU-MISSING"],
          ontology_node_ids: ["UNKNOWN-ONTOLOGY-OBJECT"],
        }],
      },
    });

    expect(context.resolution_status).toBe("partial");
    expect(context.unresolved_semantic_ids).toEqual([
      "JU-MISSING",
      "UNKNOWN-ONTOLOGY-OBJECT",
    ]);
    expect(context.reference_coverage).toBeLessThan(1);
  });

  it("does not treat human-readable input source labels as semantic ids", () => {
    const context = buildStageSemanticContext({
      stage: "stage_01",
      data: {
        input_resolution: {
          source_refs: ["当前输入：用户原始问题"],
        },
      },
    });
    expect(context.unresolved_semantic_ids).toEqual([]);
    expect(context.resolution_status).toBe("not_applicable");
  });

  it("does not treat evidence subject labels as ontology ids", () => {
    const context = buildStageSemanticContext({
      stage: "stage_03",
      data: {
        evidence_drafts: [{
          id: "EV-1",
          subject_ref: "HBM4_supply_and_yield",
          ontology_node_ids: ["task_local:HBM4"],
        }],
      },
    });
    expect(context.referenced_semantic_ids).not.toContain("HBM4_supply_and_yield");
    expect(context.task_local_ids).toEqual(["task_local:HBM4"]);
  });

  it("resolves task instance ids against the approved authority graph at export", () => {
    const context = buildStageSemanticContext({
      stage: "stage_02",
      data: {
        judgment_units: [{
          id: "JU-1",
          ontology_node_ids: ["product:HBM"],
        }],
        context_injected_assets: {
          method_guidance_ids: ["BF-SD-01"],
          scenario_card_ids: ["SCN-MEM-HBM"],
        },
      },
      additionalResolvedIds: ["product:HBM"],
    });
    expect(context.unresolved_semantic_ids).toEqual([]);
    expect(context.referenced_semantic_ids).toContain("product:HBM");
    expect(context.referenced_semantic_ids).not.toContain("BF-SD-01");
    expect(context.referenced_semantic_ids).not.toContain("SCN-MEM-HBM");
  });

  it("treats complete resolution as a production publication constraint", () => {
    const complete = buildStageSemanticContext({
      stage: "stage_02",
      data: {
        judgment_units: [{ id: "JU-1", ontology_node_ids: ["task_local:SV-1"] }],
      },
    });
    expect(validateStageSemanticContext(complete, "stage_02", {
      requireComplete: true,
      expectedFingerprint: complete.ontology_fingerprint,
    }).resolution_status).toBe("complete");

    const partial = buildStageSemanticContext({
      stage: "stage_03",
      data: {
        evidence_drafts: [{ id: "EV-1", judgment_unit_ids: ["JU-MISSING"] }],
      },
    });
    expect(() => validateStageSemanticContext(partial, "stage_03", {
      requireComplete: true,
      expectedFingerprint: partial.ontology_fingerprint,
    })).toThrow(/未解析语义引用/);
  });
});
