import { afterEach, describe, expect, it } from "vitest";
import { assertActionExecutionAccess, assertApprovalAccess, assertArtifactAccess, assertConversationAccess, assertOntologyObjectAccess, assertTaskAccess, authorizeRuntimeRequest, listAccessibleConversations, RuntimeAccessError, trustedActionContext } from "@/src/security/runtime-access";
import { RuntimeStore } from "@/src/runtime/store";
import { OntologyActionService } from "@/src/ontology/action-service";

const previous = { mode: process.env.VNEXT_RUNTIME_MODE, identities: process.env.VNEXT_SERVER_IDENTITIES_JSON, origins: process.env.VNEXT_ALLOWED_ORIGINS, csrf: process.env.VNEXT_SERVER_CSRF_TOKEN };
const stores: RuntimeStore[] = [];
const restore = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
afterEach(() => {
  restore("VNEXT_RUNTIME_MODE", previous.mode); restore("VNEXT_SERVER_IDENTITIES_JSON", previous.identities);
  restore("VNEXT_ALLOWED_ORIGINS", previous.origins); restore("VNEXT_SERVER_CSRF_TOKEN", previous.csrf);
  while (stores.length) stores.pop()?.close();
});

describe("runtime access boundary", () => {
  it("uses a server-side identity and rejects unauthenticated server requests", () => {
    process.env.VNEXT_RUNTIME_MODE = "server";
    process.env.VNEXT_SERVER_IDENTITIES_JSON = JSON.stringify([{ token: "secret-token", tenantId: "tenant-a", userId: "analyst-a", roles: ["research_owner"] }]);
    expect(authorizeRuntimeRequest(new Request("https://research.test/api/v2/research-cases", { headers: { authorization: "Bearer secret-token" } }))).toEqual({ tenantId: "tenant-a", userId: "analyst-a", roles: ["research_owner"] });
    expect(() => authorizeRuntimeRequest(new Request("https://research.test/api/v2/research-cases"))).toThrow(RuntimeAccessError);
  });

  it("requires an allowed origin and CSRF token for server mutations", () => {
    process.env.VNEXT_RUNTIME_MODE = "server";
    process.env.VNEXT_SERVER_IDENTITIES_JSON = JSON.stringify([{ token: "secret-token", tenantId: "tenant-a", userId: "analyst-a", roles: ["research_owner"] }]);
    process.env.VNEXT_ALLOWED_ORIGINS = "https://research.test"; process.env.VNEXT_SERVER_CSRF_TOKEN = "csrf-secret";
    const authorized = new Request("https://research.test/api/v2/research-cases", { method: "POST", headers: { authorization: "Bearer secret-token", origin: "https://research.test", "x-vnext-csrf-token": "csrf-secret" } });
    expect(authorizeRuntimeRequest(authorized).tenantId).toBe("tenant-a");
    expect(() => authorizeRuntimeRequest(new Request("https://research.test/api/v2/research-cases", { method: "POST", headers: { authorization: "Bearer secret-token", origin: "https://evil.test", "x-vnext-csrf-token": "csrf-secret" } }))).toThrow(/origin/i);
  });

  it("enforces tenant and user ownership for every direct research resource", () => {
    process.env.VNEXT_RUNTIME_MODE = "server";
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const own = store.createConversation("own", { tenantId: "tenant-a", userId: "analyst-a" });
    const otherUser = store.createConversation("other user", { tenantId: "tenant-a", userId: "analyst-b" });
    const otherTenant = store.createConversation("other tenant", { tenantId: "tenant-b", userId: "analyst-a" });
    const task = store.createTask({ conversationId: own.id, goal: "test", intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const artifact = store.putArtifact({ conversationId: own.id, taskId: task.id, kind: "evidence_package", title: "evidence", status: "verified", data: {}, sourceRefs: [], createdBy: "system" });
    const approval = store.createApproval({ conversationId: own.id, taskId: task.id, kind: "plan_confirmation", prompt: "confirm" });
    const request = new Request("https://research.test/api/v2/research-cases", { headers: { "x-vnext-auth-tenant": "tenant-a", "x-vnext-auth-user": "analyst-a", "x-vnext-auth-roles": "research_owner" } });

    expect(assertConversationAccess(store, request, own.id).id).toBe(own.id);
    expect(assertTaskAccess(store, request, task.id).id).toBe(task.id);
    expect(assertArtifactAccess(store, request, artifact.id).id).toBe(artifact.id);
    expect(assertApprovalAccess(store, request, approval.id).id).toBe(approval.id);
    expect(listAccessibleConversations(store, request).map((item) => item.id)).toEqual([own.id]);
    expect(() => assertConversationAccess(store, request, otherUser.id)).toThrow(/Resource not found/);
    expect(() => assertConversationAccess(store, request, otherTenant.id)).toThrow(/Resource not found/);
  });

  it("allows tenant_admin to access users in its tenant but never another tenant", () => {
    process.env.VNEXT_RUNTIME_MODE = "server";
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const sameTenant = store.createConversation("same", { tenantId: "tenant-a", userId: "analyst-b" });
    const otherTenant = store.createConversation("other", { tenantId: "tenant-b", userId: "analyst-b" });
    const request = new Request("https://research.test/api/v2/research-cases", { headers: { "x-vnext-auth-tenant": "tenant-a", "x-vnext-auth-user": "admin-a", "x-vnext-auth-roles": "tenant_admin" } });
    expect(assertConversationAccess(store, request, sameTenant.id).id).toBe(sameTenant.id);
    expect(() => assertConversationAccess(store, request, otherTenant.id)).toThrow(/Resource not found/);
  });

  it("binds ontology objects, action executions and HTTP actor context to the owned conversation", () => {
    process.env.VNEXT_RUNTIME_MODE = "server";
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const ownConversation = store.createConversation("own case", { tenantId: "tenant-a", userId: "analyst-a" });
    const foreignConversation = store.createConversation("foreign case", { tenantId: "tenant-b", userId: "analyst-b" });
    const actions = new OntologyActionService(store);
    const create = (conversationId: string) => actions.apply("CreateResearchCase", {
      targetRefs: [], parameters: { title: "case", goal: "goal", conversationRef: conversationId }, expectedVersions: {}, idempotencyKey: `case:${conversationId}`,
    }, { actorType: "researcher", actorId: "seed", conversationId });
    const own = create(ownConversation.id);
    const foreign = create(foreignConversation.id);
    const ownCase = own.objects.find((object) => object.type === "ResearchCase")!;
    const foreignCase = foreign.objects.find((object) => object.type === "ResearchCase")!;
    const ownTask = store.createTask({ conversationId: ownConversation.id, researchCaseId: ownCase.id, goal: "goal", intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    store.createTask({ conversationId: foreignConversation.id, researchCaseId: foreignCase.id, goal: "goal", intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const request = new Request("https://research.test/ontology", { headers: { "x-vnext-auth-tenant": "tenant-a", "x-vnext-auth-user": "analyst-a", "x-vnext-auth-roles": "research_owner" } });

    expect(assertOntologyObjectAccess(store, request, { id: ownCase.id, type: ownCase.type }).id).toBe(ownCase.id);
    expect(assertActionExecutionAccess(store, request, own.execution.id).id).toBe(own.execution.id);
    expect(() => assertOntologyObjectAccess(store, request, { id: foreignCase.id, type: foreignCase.type })).toThrow(/Resource not found/);
    expect(() => assertActionExecutionAccess(store, request, foreign.execution.id)).toThrow(/Resource not found/);
    expect(trustedActionContext(store, request, { actorType: "ontology_admin", actorId: "spoofed", conversationId: ownConversation.id, taskId: ownTask.id })).toMatchObject({
      actorType: "researcher", actorId: "analyst-a", conversationId: ownConversation.id,
      access: { actorType: "researcher", actorId: "analyst-a", groups: ["research_owner"] },
    });
  });
});
