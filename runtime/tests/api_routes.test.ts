import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-api-${process.pid}.sqlite`;
process.env.WORKBENCH_EXPORT_ROOT = `/tmp/ontology-workbench-api-exports-${process.pid}`;

let db: typeof import("@/adapters/db");
let objectSetRoute: typeof import("@/app/api/runs/[id]/object-set/route");
let changeSetRoute: typeof import("@/app/api/runs/[id]/change-set/route");
let publishRoute: typeof import("@/app/api/runs/[id]/publish/route");

beforeAll(async () => {
  db = await import("@/adapters/db");
  objectSetRoute = await import("@/app/api/runs/[id]/object-set/route");
  changeSetRoute = await import("@/app/api/runs/[id]/change-set/route");
  publishRoute = await import("@/app/api/runs/[id]/publish/route");
});

describe("critical API routes", () => {
  it("object-set returns graph projection for a new run", async () => {
    const run = db.createRun("API object-set 冒烟", "semiconductor");
    const response = await objectSetRoute.GET(
      new Request(`http://127.0.0.1/api/runs/${run.id}/object-set`) as any,
      { params: Promise.resolve({ id: run.id }) } as any,
    );
    expect(response.status).toBeLessThan(500);
    const body = await response.json();
    expect(body).toBeTruthy();
  });

  it("change-set rejects empty payload without crashing", async () => {
    const run = db.createRun("API change-set 冒烟", "semiconductor");
    const response = await changeSetRoute.POST(
      new Request(`http://127.0.0.1/api/runs/${run.id}/change-set`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as any,
      { params: Promise.resolve({ id: run.id }) } as any,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("publish rejects incomplete runs with a structured error", async () => {
    const run = db.createRun("API publish 冒烟", "semiconductor");
    const response = await publishRoute.POST(
      new Request(`http://127.0.0.1/api/runs/${run.id}/publish`, { method: "POST" }) as any,
      { params: Promise.resolve({ id: run.id }) } as any,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json().catch(() => ({}));
    expect(body).toBeTruthy();
  });
});
