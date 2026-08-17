import type { FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import type { UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";

export interface SourceQueryRequest {
  companyCode: string;
  companyName: string;
  query: string;
  asOf: string;
  reportPeriod?: string;
  maxResults?: number;
}

export type SourceConnectorResult = UnifiedSourceToolResult | FinancialDataToolResult;

export interface SourceConnector {
  readonly id: string;
  query(request: SourceQueryRequest): Promise<SourceConnectorResult>;
}

export class SourceConnectorError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_request" | "permission_denied" | "upstream_unavailable" | "no_match" | "stale_data" | "invalid_response",
    readonly retryable: boolean,
    readonly connectorId: string,
  ) {
    super(message);
    this.name = "SourceConnectorError";
  }
}

export interface SourceQueryTrace {
  connectorId: string;
  status: "completed" | "failed" | "circuit_open";
  error?: string;
}

export class SourceConnectorRegistry {
  private readonly connectors = new Map<string, SourceConnector>();
  private readonly failures = new Map<string, { count: number; openedAt?: number }>();

  constructor(readonly failureThreshold = 3, readonly cooldownMs = 30_000) {}

  register(connector: SourceConnector): void {
    if (this.connectors.has(connector.id)) throw new Error(`Source connector already registered: ${connector.id}`);
    this.connectors.set(connector.id, connector);
  }

  async query(request: SourceQueryRequest, preferredConnectorIds: string[]): Promise<{ result: SourceConnectorResult; trace: SourceQueryTrace[] }> {
    const trace: SourceQueryTrace[] = [];
    for (const connectorId of preferredConnectorIds) {
      const connector = this.connectors.get(connectorId);
      if (!connector) {
        trace.push({ connectorId, status: "failed", error: "connector is not registered" });
        continue;
      }
      if (this.circuitOpen(connectorId)) {
        trace.push({ connectorId, status: "circuit_open", error: "connector circuit breaker is open" });
        continue;
      }
      try {
        const result = await connector.query(request);
        this.failures.delete(connectorId);
        trace.push({ connectorId, status: "completed" });
        return { result, trace };
      } catch (error) {
        const state = this.failures.get(connectorId) || { count: 0 };
        const count = state.count + 1;
        this.failures.set(connectorId, { count, openedAt: count >= this.failureThreshold ? Date.now() : undefined });
        trace.push({ connectorId, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    throw new SourceConnectorError(`No source connector completed the request: ${trace.map((item) => `${item.connectorId}=${item.status}`).join(", ")}`, "upstream_unavailable", true, preferredConnectorIds[0] || "none");
  }

  private circuitOpen(connectorId: string): boolean {
    const state = this.failures.get(connectorId);
    if (!state?.openedAt) return false;
    if (Date.now() - state.openedAt >= this.cooldownMs) {
      this.failures.delete(connectorId);
      return false;
    }
    return true;
  }
}
