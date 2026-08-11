import { createHash } from "node:crypto";
import type { RuntimeStore } from "@/src/runtime/store";
import { ModelProviderError, type ModelProvider, type ModelRequest, type ModelResult } from "@/src/providers/model-provider";

export type ModelDataPolicy = "public" | "private_authorized" | "restricted_no_egress";

export interface ModelGatewayRequest extends ModelRequest {
  operation: string;
  promptVersion: string;
  schemaVersion?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  cache?: "read_write" | "bypass";
  dataPolicy?: ModelDataPolicy;
  validateResponse?: (value: unknown) => void;
}

export interface ModelGatewayResult extends ModelResult {
  fingerprint: string;
  cached: boolean;
  attempts: number;
  latencyMs: number;
}

const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason || new Error("aborted")); }, { once: true });
});

export function redactModelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}

function parseStructuredText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function estimateCost(result: ModelResult): number | undefined {
  const inputRate = Number(process.env.VNEXT_MODEL_INPUT_COST_PER_MILLION || 0);
  const outputRate = Number(process.env.VNEXT_MODEL_OUTPUT_COST_PER_MILLION || 0);
  if (!inputRate && !outputRate) return undefined;
  return ((result.usage?.inputTokens || 0) * inputRate + (result.usage?.outputTokens || 0) * outputRate) / 1_000_000;
}

export class ModelGateway {
  constructor(private readonly store: RuntimeStore, private readonly provider: ModelProvider) {}

  async generate(request: ModelGatewayRequest, outerSignal?: AbortSignal): Promise<ModelGatewayResult> {
    if (request.dataPolicy === "restricted_no_egress" && this.provider.id !== "local") throw new Error("Model data policy forbids external egress");
    const contextHash = hash({ system: request.system, prompt: request.prompt });
    const fingerprint = hash({ provider: this.provider.id, operation: request.operation, promptVersion: request.promptVersion, schemaVersion: request.schemaVersion, responseSchema: request.responseSchema, contextHash });
    const startedAt = new Date().toISOString();
    const started = Date.now();
    if (request.cache !== "bypass") {
      const cached = this.store.getCachedModelResult<ModelResult>(`model-gateway:${fingerprint}`);
      if (cached) {
        try {
          if (request.responseSchema) request.validateResponse?.(parseStructuredText(cached.text));
          const latencyMs = Date.now() - started;
          this.store.recordModelCall({ operation: request.operation, fingerprint, provider: cached.provider, model: cached.model, promptVersion: request.promptVersion, schemaVersion: request.schemaVersion, contextHash, status: "cached", attempts: 0, cacheHit: true, inputTokens: cached.usage?.inputTokens, outputTokens: cached.usage?.outputTokens, estimatedCostUsd: 0, latencyMs, createdAt: startedAt });
          return { ...cached, fingerprint, cached: true, attempts: 0, latencyMs };
        } catch {
          // Ignore legacy cache entries that are JSON-valid but fail the current contract.
        }
      }
    }
    const maxAttempts = Math.max(1, Math.min(request.maxAttempts || 2, 3));
    let attempts = 0;
    let lastError: unknown;
    while (attempts < maxAttempts) {
      attempts += 1;
      const timeout = AbortSignal.timeout(Math.max(1_000, request.timeoutMs || 45_000));
      const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
      try {
        const result = await this.provider.generate(request, signal);
        if (request.responseSchema) {
          const structured = parseStructuredText(result.text);
          request.validateResponse?.(structured);
        }
        const latencyMs = Date.now() - started;
        if (request.cache !== "bypass") this.store.cacheModelResult(`model-gateway:${fingerprint}`, result.provider, result.model, result);
        this.store.recordModelCall({ operation: request.operation, fingerprint, provider: result.provider, model: result.model, promptVersion: request.promptVersion, schemaVersion: request.schemaVersion, contextHash, status: "completed", attempts, cacheHit: false, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, estimatedCostUsd: estimateCost(result), latencyMs, createdAt: startedAt });
        return { ...result, fingerprint, cached: false, attempts, latencyMs };
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ModelProviderError ? error.retryable : error instanceof SyntaxError;
        if (!retryable || attempts >= maxAttempts || outerSignal?.aborted) break;
        await delay(200 * 2 ** (attempts - 1), outerSignal);
      }
    }
    const latencyMs = Date.now() - started;
    const error = redactModelError(lastError);
    this.store.recordModelCall({ operation: request.operation, fingerprint, provider: this.provider.id, model: "unknown", promptVersion: request.promptVersion, schemaVersion: request.schemaVersion, contextHash, status: "failed", attempts, cacheHit: false, latencyMs, error, createdAt: startedAt });
    throw new Error(error);
  }
}
