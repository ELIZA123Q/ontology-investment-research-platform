import { beforeAll,describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
process.env.WORKBENCH_DB_PATH=`/tmp/ontology-workbench-${process.pid}.sqlite`;
let api:typeof import("@/adapters/db");
beforeAll(async()=>{api=await import("@/adapters/db")});
describe("artifact history",()=>{
  it("creates immutable versions",()=>{const run=api.createRun("测试问题","semiconductor");const a=api.createArtifact(run.id,"stage_01",{status:"needs_review"});const b=api.createArtifact(run.id,"stage_01",{status:"needs_review"});expect(a.version).toBe(1);expect(b.version).toBe(2);expect(api.listArtifacts(run.id)).toHaveLength(2)});
  it("normalizes tracking URLs",()=>{expect(api.normalizeUrl("HTTPS://Example.com/a/?utm_source=x#part")).toBe("https://example.com/a")});
  it("creates new runs on public contract 1.3",()=>{const run=api.createRun("合同版本测试","semiconductor");const manifest=JSON.parse(run.manifest_json);expect(manifest.schema_version).toBe("1.3.0");expect(manifest.versions.contract).toBe("1.3.0");expect(manifest.versions.ontology).toBe("3.0.0")});
});
