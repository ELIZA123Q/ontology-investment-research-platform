import { timingSafeEqual } from "node:crypto";
import type { FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import type { UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";

export type ConnectorIngestionEnvelope =
  | { taskId: string; kind: "source_capture"; result: UnifiedSourceToolResult }
  | { taskId: string; kind: "financial_data"; result: FinancialDataToolResult };

export class ConnectorIngestionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const credentialKey = /(?:^|_)(?:api_?key|access_?token|refresh_?token|authorization|cookie|password|secret|credential)(?:$|_)/i;
const connectorIdPattern = /^[a-z0-9][a-z0-9._:-]{1,99}$/i;

export function assertConnectorRequestAuthorized(request: Request, configuredToken = process.env.VNEXT_CONNECTOR_INGEST_TOKEN): void {
  if (!configuredToken?.trim()) throw new ConnectorIngestionError("Connector ingestion is not configured", 503);
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : request.headers.get("x-vnext-connector-token") || "";
  const expectedBuffer = Buffer.from(configuredToken);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) throw new ConnectorIngestionError("Connector ingestion token is invalid", 401);
}

export function validateConnectorEnvelope(
  input: unknown,
  configuredConnectorIds = process.env.VNEXT_CONNECTOR_IDS,
): ConnectorIngestionEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConnectorIngestionError("Connector envelope must be an object", 400);
  const envelope = input as Partial<ConnectorIngestionEnvelope> & { result?: { connectorId?: unknown } };
  if (typeof envelope.taskId !== "string" || !envelope.taskId.trim()) throw new ConnectorIngestionError("taskId is required", 400);
  if (envelope.kind !== "source_capture" && envelope.kind !== "financial_data") throw new ConnectorIngestionError("kind must be source_capture or financial_data", 400);
  if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) throw new ConnectorIngestionError("result is required", 400);
  const connectorId = envelope.result.connectorId;
  if (typeof connectorId !== "string" || !connectorIdPattern.test(connectorId)) throw new ConnectorIngestionError("result.connectorId is invalid", 400);
  const allowed = new Set((configuredConnectorIds || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.size) throw new ConnectorIngestionError("No connector IDs are configured", 503);
  if (!allowed.has(connectorId)) throw new ConnectorIngestionError(`Connector is not allowed: ${connectorId}`, 403);
  assertNoCredentialFields(envelope.result);
  const serializedBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (serializedBytes > 5_000_000) throw new ConnectorIngestionError("Connector envelope exceeds 5 MB", 413);
  if (envelope.kind === "source_capture") {
    const capture = (envelope.result as Partial<UnifiedSourceToolResult>).capture;
    if (capture?.body && Buffer.byteLength(capture.body, "utf8") > 2_000_000) throw new ConnectorIngestionError("Captured source body exceeds 2 MB", 413);
    if (capture?.quote && capture.quote.length > 20_000) throw new ConnectorIngestionError("Captured quote exceeds 20,000 characters", 413);
  } else {
    const observations = (envelope.result as Partial<FinancialDataToolResult>).observations;
    if (Array.isArray(observations) && observations.length > 1_000) throw new ConnectorIngestionError("Financial ingestion exceeds 1,000 observations", 413);
  }
  return envelope as ConnectorIngestionEnvelope;
}

function assertNoCredentialFields(value: unknown, path = "result"): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (credentialKey.test(key)) throw new ConnectorIngestionError(`Credential field is forbidden in connector results: ${path}.${key}`, 400);
    assertNoCredentialFields(child, `${path}.${key}`);
  }
}
