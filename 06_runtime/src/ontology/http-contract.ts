import type { ActionContext, ActionPreviewRequest } from "@/src/contracts/ontology";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The public API accepts the documented flat action contract. A legacy
 * `{ request, context }` envelope remains readable so existing local callers do
 * not break while local pre-vNext callers are migrated.
 */
export function parseActionHttpBody(value: unknown): { request: ActionPreviewRequest; context: ActionContext } {
  if (!isRecord(value)) throw new Error("Action request body must be an object");
  const requestValue = isRecord(value.request) ? value.request : value;
  const contextValue = value.context;
  if (!isRecord(contextValue) || typeof contextValue.actorId !== "string" || typeof contextValue.actorType !== "string") {
    throw new Error("context.actorId and context.actorType are required");
  }
  if (!Array.isArray(requestValue.targetRefs) || !isRecord(requestValue.parameters) || !isRecord(requestValue.expectedVersions)) {
    throw new Error("targetRefs, parameters and expectedVersions are required");
  }
  if (typeof requestValue.idempotencyKey !== "string") throw new Error("idempotencyKey is required");
  return {
    request: requestValue as unknown as ActionPreviewRequest,
    context: contextValue as unknown as ActionContext,
  };
}
