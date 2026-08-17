import { describe, expect, it, vi } from "vitest";
import { DSH_GATEWAY_TOKEN_HEADER, DshGatewayAccessError, assertDshGatewayAuthorized } from "@/src/dsh/gateway-auth";

describe("DSH gateway authentication", () => {
  it("fails closed when no shared token is configured", () => {
    const env = process.env.VNEXT_DSH_GATEWAY_TOKEN;
    delete process.env.VNEXT_DSH_GATEWAY_TOKEN;
    try {
      expect(() => assertDshGatewayAuthorized(new Request("http://localhost"))).toThrow(DshGatewayAccessError);
    } finally {
      if (env === undefined) delete process.env.VNEXT_DSH_GATEWAY_TOKEN;
      else process.env.VNEXT_DSH_GATEWAY_TOKEN = env;
    }
  });

  it("accepts only the configured token", () => {
    vi.stubEnv("VNEXT_DSH_GATEWAY_TOKEN", "correct-token");
    expect(() => assertDshGatewayAuthorized(new Request("http://localhost", { headers: { [DSH_GATEWAY_TOKEN_HEADER]: "wrong-token" } }))).toThrow(/Unauthorized/);
    expect(() => assertDshGatewayAuthorized(new Request("http://localhost", { headers: { [DSH_GATEWAY_TOKEN_HEADER]: "correct-token" } }))).not.toThrow();
    vi.unstubAllEnvs();
  });
});
