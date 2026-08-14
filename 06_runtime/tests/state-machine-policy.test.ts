import { describe, expect, it } from "vitest";
import { InvalidStateTransitionError, TASK_OUTCOME_VALUES, transitionState } from "@/src/runtime/state-machine";
import { knowledgePromotionThreshold, minimumIndependentPublishers, requiredKnowledgeApprovalRoles } from "@/src/governance/policy-engine";
import { STATE_MACHINE_CATALOG } from "@/src/generated/domain-catalog";

describe("04 lifecycle projection", () => {
  it("executes declared task transitions", () => {
    expect(transitionState("Task", "planned", "confirm_plan")).toEqual({
      from: "planned", to: "queued", command: "confirm_plan", event: "plan.confirmed",
    });
  });

  it("rejects undeclared transitions deterministically", () => {
    expect(() => transitionState("Task", "completed", "retry")).toThrow(InvalidStateTransitionError);
  });

  it("executes every transition declared by 04", () => {
    for (const [machineName, rawMachine] of Object.entries(STATE_MACHINE_CATALOG.state_machines)) {
      const machine = rawMachine as unknown as { transitions?: Array<{ from: string | string[]; command: string; to: string; event: string }> };
      for (const declared of machine.transitions || []) {
        for (const from of Array.isArray(declared.from) ? declared.from : [declared.from]) {
          expect(transitionState(machineName as Parameters<typeof transitionState>[0], from, declared.command)).toMatchObject({
            from, to: declared.to, command: declared.command, event: declared.event,
          });
        }
      }
    }
  });

  it("rejects a representative undeclared command for every state machine", () => {
    for (const [machineName, rawMachine] of Object.entries(STATE_MACHINE_CATALOG.state_machines)) {
      const machine = rawMachine as unknown as { states: string[] };
      expect(() => transitionState(machineName as Parameters<typeof transitionState>[0], machine.states[0], "__undeclared__")).toThrow(InvalidStateTransitionError);
    }
  });

  it("projects every governed task outcome", () => {
    expect(TASK_OUTCOME_VALUES).toEqual([
      "completed_supported", "completed_indeterminate", "stopped_insufficient_evidence",
      "blocked_permission", "blocked_missing_source", "blocked_policy", "failed_technical", "cancelled_by_user",
    ]);
  });
});

describe("05 governance policy projection", () => {
  it("uses governed evidence thresholds", () => {
    expect(minimumIndependentPublishers("support")).toBe(2);
    expect(minimumIndependentPublishers("counter")).toBe(1);
  });

  it("routes knowledge approvals and thresholds from the contract", () => {
    expect(requiredKnowledgeApprovalRoles({ riskLevel: 2, assetKind: "method" })).toEqual(["method_owner"]);
    expect(requiredKnowledgeApprovalRoles({ riskLevel: 3, assetKind: "ontology" })).toEqual(["ontology_steward", "runtime_owner", "independent_reviewer"]);
    expect(knowledgePromotionThreshold("skill")).toMatchObject({ minimumDistinctRuns: 5, minimumTaskFamilies: 3, minimumScoreDelta: 0.05 });
  });
});
