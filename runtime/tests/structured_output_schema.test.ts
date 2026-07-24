import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertModelStructuredSchema,
  MODEL_STRUCTURED_SCHEMAS,
} from "@/engine/structured_output_schema";
import { classifyRuntimeFailure } from "@/engine/workflow_support";

describe("model structured output schema contract", () => {
  it("registers every generateStructured schema and passes zodFunction", () => {
    for (const [name, schema] of Object.entries(MODEL_STRUCTURED_SCHEMAS)) {
      expect(() => assertModelStructuredSchema(name, schema)).not.toThrow();
    }
    expect(Object.keys(MODEL_STRUCTURED_SCHEMAS).length).toBeGreaterThanOrEqual(11);
  });

  it("rejects bare .optional() fields before generation starts", () => {
    const badSchema = z.object({
      statement: z.string().optional(),
    });
    try {
      assertModelStructuredSchema("bad_optional", badSchema);
      expect.unreachable("bare optional schema should fail contract check");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("[structured_schema_contract] bad_optional:");
      expect(message).toMatch(/optional\(\).*nullable/);
    }
  });

  it("classifies structured schema contract failures as implementation errors", () => {
    expect(classifyRuntimeFailure(new Error("[structured_schema_contract] stage_02: bad field")))
      .toBe("contract_implementation_error");
  });

  it("does not misclassify Zod enum issues as method_not_applicable", () => {
    const zodNoise = JSON.stringify([
      {
        code: "invalid_value",
        values: ["pass", "fail", "partial", "not_checked"],
        path: ["method_applications", 2, "precondition_checks", 1, "result"],
        message: "Invalid input",
      },
      {
        code: "invalid_value",
        values: ["capacity", "yield"],
        path: ["evidence_drafts", 10, "semiconductor_measurement", "metric_kind"],
        message: "Invalid input",
      },
    ]);
    expect(classifyRuntimeFailure(new Error(zodNoise))).toBe("model_output_error");
    expect(classifyRuntimeFailure(new Error("方法不适用：前置条件失败"))).toBe("method_not_applicable");
  });
});
