import { createHash, timingSafeEqual } from "node:crypto";
import type { ActionContext, ActionExecution, ApprovalRequest, Artifact, Conversation, OntologyObject, OntologyObjectRef, ResearchSignalCandidate, Task } from "@/src/contracts";
import { OntologyStore } from "@/src/ontology/store";
import type { RuntimeStore } from "@/src/runtime/store";

export type RuntimeMode = "local" | "server";
export interface RuntimeIdentity { tenantId: string; userId: string; roles: string[]; }
interface ServerIdentityConfig extends RuntimeIdentity { token: string; }

const windows = new Map<string, { startedAt: number; reads: number; mutations: number }>();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const same = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class RuntimeAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "RuntimeAccessError"; }
}

export function runtimeMode(): RuntimeMode {
  const value = process.env.VNEXT_RUNTIME_MODE?.trim() || "local";
  if (value !== "local" && value !== "server") throw new RuntimeAccessError("VNEXT_RUNTIME_MODE must be local or server", 500);
  return value;
}

function serverIdentities(): ServerIdentityConfig[] {
  const raw = process.env.VNEXT_SERVER_IDENTITIES_JSON?.trim();
  if (!raw) throw new RuntimeAccessError("Server mode requires VNEXT_SERVER_IDENTITIES_JSON", 503);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new RuntimeAccessError("VNEXT_SERVER_IDENTITIES_JSON is invalid", 503); }
  if (!Array.isArray(parsed)) throw new RuntimeAccessError("VNEXT_SERVER_IDENTITIES_JSON must be an array", 503);
  const identities = parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const token = String(value.token || "").trim(); const tenantId = String(value.tenantId || "").trim(); const userId = String(value.userId || "").trim();
    const roles = Array.isArray(value.roles) ? value.roles.map(String).filter(Boolean) : [];
    return token && tenantId && userId && roles.length ? [{ token, tenantId, userId, roles }] : [];
  });
  if (!identities.length) throw new RuntimeAccessError("Server mode has no valid identities", 503);
  return identities;
}

function assertOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const allowed = new Set((process.env.VNEXT_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!origin || !allowed.has(origin)) throw new RuntimeAccessError("Mutation origin is not allowed", 403);
  const expected = process.env.VNEXT_SERVER_CSRF_TOKEN?.trim();
  const provided = request.headers.get("x-vnext-csrf-token") || "";
  if (!expected || !same(expected, provided)) throw new RuntimeAccessError("CSRF token is invalid", 403);
}

function enforceRateLimit(key: string, mutation: boolean): void {
  const current = Date.now();
  const slot = windows.get(key);
  const window = !slot || current - slot.startedAt >= 60_000 ? { startedAt: current, reads: 0, mutations: 0 } : slot;
  if (mutation) window.mutations += 1; else window.reads += 1;
  windows.set(key, window);
  if (window.reads > Number(process.env.VNEXT_SERVER_READS_PER_MINUTE || 120) || window.mutations > Number(process.env.VNEXT_SERVER_MUTATIONS_PER_MINUTE || 30)) throw new RuntimeAccessError("Rate limit exceeded", 429);
}

export function authorizeRuntimeRequest(request: Request): RuntimeIdentity {
  const mode = runtimeMode();
  const url = new URL(request.url);
  if (mode === "local") {
    if (process.env.NODE_ENV !== "test" && !loopbackHosts.has(url.hostname)) throw new RuntimeAccessError("Local mode only accepts loopback requests", 403);
    return { tenantId: "default", userId: "researcher", roles: ["research_owner"] };
  }
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const identity = serverIdentities().find((candidate) => same(candidate.token, token));
  if (!identity) throw new RuntimeAccessError("Unauthorized", 401);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  if (mutation) assertOrigin(request);
  if (mutation && !identity.roles.some((role) => ["research_owner", "researcher", "tenant_admin"].includes(role))) throw new RuntimeAccessError("Role cannot mutate research state", 403);
  enforceRateLimit(createHash("sha256").update(token).digest("hex"), mutation);
  return { tenantId: identity.tenantId, userId: identity.userId, roles: identity.roles };
}

export function identityFromTrustedHeaders(request: Request): RuntimeIdentity {
  if (runtimeMode() === "local") return { tenantId: "default", userId: "researcher", roles: ["research_owner"] };
  const tenantId = request.headers.get("x-vnext-auth-tenant") || "";
  const userId = request.headers.get("x-vnext-auth-user") || "";
  const roles = (request.headers.get("x-vnext-auth-roles") || "").split(",").filter(Boolean);
  if (!tenantId || !userId || !roles.length) throw new RuntimeAccessError("Trusted runtime identity is missing", 401);
  return { tenantId, userId, roles };
}

function ownsConversation(identity: RuntimeIdentity, conversation: Conversation): boolean {
  return conversation.tenantId === identity.tenantId
    && (conversation.userId === identity.userId || identity.roles.includes("tenant_admin"));
}

function identityFor(request: Request): RuntimeIdentity {
  return identityFromTrustedHeaders(request);
}

function inaccessible(): never {
  throw new RuntimeAccessError("Resource not found", 404);
}

export function listAccessibleConversations(store: RuntimeStore, request: Request): Conversation[] {
  const identity = identityFor(request);
  return store.listConversations().filter((conversation) => ownsConversation(identity, conversation));
}

export function assertConversationAccess(store: RuntimeStore, request: Request, conversationId: string): Conversation {
  const conversation = store.getConversation(conversationId);
  if (!conversation || !ownsConversation(identityFor(request), conversation)) return inaccessible();
  return conversation;
}

export function assertTaskAccess(store: RuntimeStore, request: Request, taskId: string): Task {
  const task = store.getTask(taskId);
  if (!task) return inaccessible();
  assertConversationAccess(store, request, task.conversationId);
  return task;
}

export function assertArtifactAccess(store: RuntimeStore, request: Request, artifactId: string): Artifact {
  const artifact = store.getArtifact(artifactId);
  if (!artifact) return inaccessible();
  assertConversationAccess(store, request, artifact.conversationId);
  return artifact;
}

export function assertApprovalAccess(store: RuntimeStore, request: Request, approvalId: string): ApprovalRequest {
  const approval = store.getApproval(approvalId);
  if (!approval) return inaccessible();
  assertConversationAccess(store, request, approval.conversationId);
  return approval;
}

export function assertSignalCandidateAccess(store: RuntimeStore, request: Request, signalId: string): ResearchSignalCandidate & { content: string } {
  const candidate = store.getSignalCandidate(signalId);
  if (!candidate) return inaccessible();
  assertConversationAccess(store, request, candidate.conversationId);
  return candidate;
}

function researchCaseConversationId(store: RuntimeStore, researchCase: OntologyObject): string | undefined {
  const propertyRef = researchCase.properties.conversation_ref || researchCase.properties.conversationId;
  if (typeof propertyRef === "string" && propertyRef) return propertyRef;
  return store.getLatestTaskForResearchCase(researchCase.id)?.conversationId;
}

function relatedResearchCases(store: RuntimeStore, ref: OntologyObjectRef): OntologyObject[] {
  const ontology = new OntologyStore(store);
  const root = ontology.getObject(ref.id);
  if (!root || root.type !== ref.type) return [];
  const queue = [root.id];
  const visited = new Set<string>();
  const cases: OntologyObject[] = [];
  while (queue.length && visited.size < 2_000) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const object = ontology.getObject(id);
    if (object?.type === "ResearchCase") cases.push(object);
    for (const link of ontology.listLinksForObject(id)) {
      const other = link.sourceRef.id === id ? link.targetRef.id : link.sourceRef.id;
      if (!visited.has(other)) queue.push(other);
    }
  }
  return cases;
}

export function assertOntologyObjectAccess(store: RuntimeStore, request: Request, ref: OntologyObjectRef): OntologyObject {
  const ontology = new OntologyStore(store);
  const object = ontology.getObject(ref.id);
  if (!object || object.type !== ref.type) return inaccessible();
  if (object.type === "ActionExecution") {
    assertActionExecutionAccess(store, request, object.id);
    return object;
  }
  const cases = relatedResearchCases(store, ref);
  if (!cases.length) return inaccessible();
  const accessible = cases.some((researchCase) => {
    const conversationId = researchCaseConversationId(store, researchCase);
    if (!conversationId) return false;
    try { assertConversationAccess(store, request, conversationId); return true; } catch { return false; }
  });
  if (!accessible) return inaccessible();
  return object;
}

export function assertResearchCaseAccess(store: RuntimeStore, request: Request, researchCaseId: string): OntologyObject {
  return assertOntologyObjectAccess(store, request, { id: researchCaseId, type: "ResearchCase" });
}

export function assertActionExecutionAccess(store: RuntimeStore, request: Request, executionId: string): ActionExecution {
  const execution = new OntologyStore(store).getActionExecution(executionId);
  if (!execution?.conversationId) return inaccessible();
  assertConversationAccess(store, request, execution.conversationId);
  return execution;
}

export function trustedActionContext(store: RuntimeStore, request: Request, context: ActionContext): ActionContext {
  if (!context.conversationId) throw new RuntimeAccessError("Action context requires conversationId", 400);
  assertConversationAccess(store, request, context.conversationId);
  if (context.taskId) {
    const task = assertTaskAccess(store, request, context.taskId);
    if (task.conversationId !== context.conversationId) return inaccessible();
  }
  const identity = identityFor(request);
  const actorType = context.actorType === "ontology_admin" && identity.roles.includes("tenant_admin") ? "ontology_admin" : "researcher";
  return {
    ...context,
    actorId: identity.userId,
    actorType,
    access: { actorId: identity.userId, actorType, groups: identity.roles },
  };
}

export function runtimeAccessStatus(error: unknown, fallback = 400): number {
  return error instanceof RuntimeAccessError ? error.status : fallback;
}
