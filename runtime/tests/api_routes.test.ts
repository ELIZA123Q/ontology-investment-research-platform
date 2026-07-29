import { beforeAll, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
// Use a workspace-local DB so experience enrollment remains cohort-eligible in API tests.
process.env.WORKBENCH_DB_PATH = resolve(
  process.cwd(),
  `../instances/00_本机运行/.vitest-api-${process.pid}.sqlite`,
);
process.env.WORKBENCH_EXPORT_ROOT = resolve(
  process.cwd(),
  `../instances/00_本机运行/.vitest-api-exports-${process.pid}`,
);

let db: typeof import("@/adapters/db");
let objectSetRoute: typeof import("@/app/api/runs/[id]/object-set/route");
let changeSetRoute: typeof import("@/app/api/runs/[id]/change-set/route");
let publishRoute: typeof import("@/app/api/runs/[id]/publish/route");
let runRoute: typeof import("@/app/api/runs/[id]/route");
let continueRoute: typeof import("@/app/api/runs/[id]/continue/route");
let runsRoute: typeof import("@/app/api/runs/route");
let experienceCohort: typeof import("@/adapters/experience_cohort");
let researchJobs: typeof import("@/adapters/research_jobs");

beforeAll(async () => {
  db = await import("@/adapters/db");
  objectSetRoute = await import("@/app/api/runs/[id]/object-set/route");
  changeSetRoute = await import("@/app/api/runs/[id]/change-set/route");
  publishRoute = await import("@/app/api/runs/[id]/publish/route");
  runRoute = await import("@/app/api/runs/[id]/route");
  continueRoute = await import("@/app/api/runs/[id]/continue/route");
  runsRoute = await import("@/app/api/runs/route");
  experienceCohort = await import("@/adapters/experience_cohort");
  researchJobs = await import("@/adapters/research_jobs");
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

  it("DELETE /api/runs/[id] removes the run", async () => {
    const run = db.createRun(`API 删除研究-${crypto.randomUUID()}`, "semiconductor");
    const missing = await runRoute.DELETE(
      new Request(`http://127.0.0.1/api/runs/missing`, { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "missing" }) } as any,
    );
    expect(missing.status).toBe(404);

    const response = await runRoute.DELETE(
      new Request(`http://127.0.0.1/api/runs/${run.id}`, { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: run.id }) } as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.deleted_ids).toContain(run.id);
    expect(db.getRun(run.id)).toBeUndefined();
  });

  it("continues only to the next human gate and deduplicates an active job", async () => {
    const run = db.createRun(`API 下一人工门-${crypto.randomUUID()}`, "semiconductor");
    const request = () => new Request(`http://127.0.0.1/api/runs/${run.id}/continue`, { method: "POST" });
    const context = { params: Promise.resolve({ id: run.id }) } as any;

    const first = await continueRoute.POST(request(), context);
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ next_href: `/runs/${run.id}/scope`, stop_at: "human_review" });

    const second = await continueRoute.POST(request(), context);
    expect(second.status).toBe(202);
    const secondBody = await second.json();
    expect(secondBody.job.id).toBe(firstBody.job.id);
    expect(researchJobs.listResearchJobsForRun(run.id)).toHaveLength(1);
  });

  it("does not enqueue across an artifact awaiting human review", async () => {
    const run = db.createRun(`API 人工门-${crypto.randomUUID()}`, "semiconductor");
    db.createArtifact(run.id, "stage_01", { status: "needs_review" });
    const response = await continueRoute.POST(
      new Request(`http://127.0.0.1/api/runs/${run.id}/continue`, { method: "POST" }),
      { params: Promise.resolve({ id: run.id }) } as any,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "当前阶段已有待确认结果，请先人工确认",
      next_href: `/runs/${run.id}/scope`,
    });
    expect(researchJobs.listResearchJobsForRun(run.id)).toHaveLength(0);
  });

  it("enrolls a frozen experience case once and rejects drift or duplicates", async () => {
    const definition = experienceCohort.getExperienceCohortCaseDefinition("RXB-S02")!;
    const request = (question: string) => new Request("http://127.0.0.1/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        domain: "semiconductor",
        experience_case_id: definition.case_id,
      }),
    });

    const drifted = await runsRoute.POST(request(`${definition.question} 改写`));
    expect(drifted.status).toBe(400);

    const created = await runsRoute.POST(request(definition.question));
    expect(created.status).toBe(201);
    const run = await created.json();
    const creationEvent = db.listResearchExperienceEvents(run.id).find((item) => item.event_type === "run_created")!;
    expect(JSON.parse(creationEvent.payload_json).experience_case_id).toBe("RXB-S02");

    const duplicate = await runsRoute.POST(request(definition.question));
    expect(duplicate.status).toBe(409);
  });
});
