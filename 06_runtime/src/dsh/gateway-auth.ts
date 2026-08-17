import { timingSafeEqual } from "node:crypto";

export const DSH_GATEWAY_TOKEN_HEADER = "x-investment-dsh-token";

export class DshGatewayAccessError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "DshGatewayAccessError";
  }
}

function sameSecret(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

/**
 * The DSH process is a separate local application.  It may reach the domain
 * service only through this token fence; existing browser routes remain their
 * own trust boundary.
 */
export function assertDshGatewayAuthorized(request: Request): void {
  const configured = process.env.VNEXT_DSH_GATEWAY_TOKEN?.trim();
  if (!configured) throw new DshGatewayAccessError("DSH gateway is not configured", 503);
  const supplied = request.headers.get(DSH_GATEWAY_TOKEN_HEADER)?.trim() || "";
  if (!supplied || !sameSecret(configured, supplied)) throw new DshGatewayAccessError("Unauthorized DSH gateway request");
}

export function dshGatewayErrorResponse(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof DshGatewayAccessError) return { status: error.status, body: { error: error.message } };
  return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
}
