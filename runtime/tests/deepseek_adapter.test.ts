import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { parseDirectJson } from "@/adapters/deepseek";

describe("DeepSeek structured-output recovery", () => {
  const schema = z.object({ decision: z.enum(["supported", "indeterminate"]), evidence_ids: z.array(z.string()) });

  it("accepts a validated plain JSON result and strips a defensive code fence", () => {
    expect(parseDirectJson('{"decision":"supported","evidence_ids":["EV-1"]}', schema))
      .toEqual({ decision: "supported", evidence_ids: ["EV-1"] });
    expect(parseDirectJson('```json\n{"decision":"indeterminate","evidence_ids":[]}\n```', schema))
      .toEqual({ decision: "indeterminate", evidence_ids: [] });
  });

  it("still rejects malformed or contract-breaking fallback output", () => {
    expect(() => parseDirectJson("not-json", schema)).toThrow(/无法解析/);
    expect(() => parseDirectJson('{"decision":"supported","evidence_ids":"EV-1"}', schema)).toThrow();
  });
});
