import { createHash } from "node:crypto";

export function requestFingerprint(provider: string, model: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ provider, model, input })).digest("hex");
}
