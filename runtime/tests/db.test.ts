import { beforeAll,describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
process.env.WORKBENCH_DB_PATH=`/tmp/ontology-workbench-${process.pid}.sqlite`;
let api:typeof import("@/adapters/db");
beforeAll(async()=>{api=await import("@/adapters/db")});
describe("artifact history",()=>{
  it("creates immutable versions",()=>{const run=api.createRun("测试问题","semiconductor");const a=api.createArtifact(run.id,"stage_01",{status:"needs_review"});const b=api.createArtifact(run.id,"stage_01",{status:"needs_review"});expect(a.version).toBe(1);expect(b.version).toBe(2);expect(api.listArtifacts(run.id)).toHaveLength(2)});
  it("normalizes tracking URLs",()=>{expect(api.normalizeUrl("HTTPS://Example.com/a/?utm_source=x#part")).toBe("https://example.com/a")});
});
