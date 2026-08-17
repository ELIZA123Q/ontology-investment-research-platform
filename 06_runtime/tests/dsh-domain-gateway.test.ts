import { describe, expect, it, vi } from "vitest";
import {
  DSH_GATEWAY_TOKEN_HEADER, FORBIDDEN_MODEL_COMMANDS, InvestmentDomainGateway,
  assertModelCommandPermitted,
} from "../packages/dsh-investment-research/src/domain-gateway.js";

describe("DSH investment domain gateway", () => {
  it("uses the authenticated local gateway and returns a domain reference envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      apiVersion: "v1",
      researchCase: { id: "case-1", taskId: "task-1", bundleId: "sha256:bundle" },
      knowledgeRunLock: { bundleId: "sha256:bundle" },
      runtime: { task: { id: "task-1" }, artifacts: [{ id: "artifact-1", kind: "research_plan", version: 1 }] },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const gateway = new InvestmentDomainGateway({ baseUrl: "http://127.0.0.1:3000", apiToken: "local-token" }, fetchMock);

    const result = await gateway.getResearchCase("case-1");

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/api/dsh/v1/research-cases/case-1", expect.objectContaining({
      method: "GET", headers: expect.objectContaining({ [DSH_GATEWAY_TOKEN_HEADER]: "local-token" }),
    }));
    expect(result).toMatchObject({
      apiVersion: "v1", operation: "research_case.get", researchCaseId: "case-1", taskId: "task-1", knowledgeBundleId: "sha256:bundle",
      artifactRefs: [{ id: "artifact-1", kind: "research_plan", version: 1 }],
    });
  });

  it("never permits model-facing formal research commands", () => {
    for (const command of FORBIDDEN_MODEL_COMMANDS) expect(() => assertModelCommandPermitted(command)).toThrow(/Researcher confirmation/);
    expect(() => assertModelCommandPermitted("attach_material")).not.toThrow();
  });
});
