import { afterEach, describe, expect, it } from "vitest";
import { ModelGateway } from "@/src/providers/model-gateway";
import { ModelProviderError, type ModelProvider } from "@/src/providers/model-provider";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

const request = {
  operation: "test:structured",
  promptVersion: "test/1.0.0",
  schemaVersion: "test/1.0.0",
  system: "Return JSON",
  prompt: "test input",
  responseSchema: { type: "object" },
};

describe("model gateway", () => {
  it("records a completed call and a deterministic cache hit", async () => {
    const store = new RuntimeStore(":memory:");
    stores.push(store);
    let calls = 0;
    const provider: ModelProvider = {
      id: "fake",
      async generate() {
        calls += 1;
        return { provider: "fake", model: "test-model", text: '{"ok":true}', usage: { inputTokens: 7, outputTokens: 3 } };
      },
    };
    const gateway = new ModelGateway(store, provider);
    const first = await gateway.generate(request);
    const second = await gateway.generate(request);

    expect(calls).toBe(1);
    expect(first).toMatchObject({ cached: false, attempts: 1 });
    expect(second).toMatchObject({ cached: true, attempts: 0, fingerprint: first.fingerprint });
    expect(store.listModelCalls()).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "completed", cacheHit: false, inputTokens: 7, outputTokens: 3 }),
      expect.objectContaining({ status: "cached", cacheHit: true }),
    ]));
  });

  it("retries transient failures and redacts credentials from the terminal record", async () => {
    const store = new RuntimeStore(":memory:");
    stores.push(store);
    let calls = 0;
    const retryingProvider: ModelProvider = {
      id: "fake",
      async generate() {
        calls += 1;
        if (calls === 1) throw new ModelProviderError("temporary", true, 503);
        return { provider: "fake", model: "test-model", text: '{"ok":true}' };
      },
    };
    const result = await new ModelGateway(store, retryingProvider).generate({ ...request, cache: "bypass", maxAttempts: 2 });
    expect(result.attempts).toBe(2);

    const failingProvider: ModelProvider = {
      id: "external",
      async generate() { throw new ModelProviderError("Bearer sk-secretcredential123456789", false, 401); },
    };
    await expect(new ModelGateway(store, failingProvider).generate({ ...request, operation: "test:redaction", cache: "bypass" })).rejects.toThrow("[REDACTED]");
    expect(store.listModelCalls()[0]).toMatchObject({ status: "failed", error: "Bearer [REDACTED]" });
  });

  it("blocks restricted context before calling an external provider", async () => {
    const store = new RuntimeStore(":memory:");
    stores.push(store);
    let called = false;
    const provider: ModelProvider = {
      id: "external",
      async generate() { called = true; return { provider: "external", model: "x", text: "{}" }; },
    };
    await expect(new ModelGateway(store, provider).generate({ ...request, dataPolicy: "restricted_no_egress" })).rejects.toThrow(/forbids external egress/);
    expect(called).toBe(false);
  });

  it("does not persist JSON that fails the caller response contract", async () => {
    const store = new RuntimeStore(":memory:");
    stores.push(store);
    let calls = 0;
    const provider: ModelProvider = {
      id: "fake",
      async generate() {
        calls += 1;
        return { provider: "fake", model: "test-model", text: calls === 1 ? '{"wrong":true}' : '{"ok":true}' };
      },
    };
    const validateResponse = (value: unknown) => {
      if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) throw new Error("response contract failed");
    };
    await expect(new ModelGateway(store, provider).generate({ ...request, validateResponse })).rejects.toThrow(/response contract failed/);
    const result = await new ModelGateway(store, provider).generate({ ...request, validateResponse });
    expect(result.cached).toBe(false);
    expect(calls).toBe(2);
  });
});
