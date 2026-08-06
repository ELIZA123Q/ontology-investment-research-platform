import { beforeAll,describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
process.env.WORKBENCH_DB_PATH=`/tmp/ontology-workbench-${process.pid}.sqlite`;
let api:typeof import("@/storage/db");
beforeAll(async()=>{api=await import("@/storage/db")});
describe("artifact history",()=>{
  it("creates immutable versions",()=>{const run=api.createRun("测试问题","semiconductor");const a=api.createArtifact(run.id,"stage_01",{status:"needs_review"});const b=api.createArtifact(run.id,"stage_01",{status:"needs_review"});expect(a.version).toBe(1);expect(b.version).toBe(2);expect(api.listArtifacts(run.id)).toHaveLength(2)});
  it("normalizes tracking URLs",()=>{expect(api.normalizeUrl("HTTPS://Example.com/a/?utm_source=x#part")).toBe("https://example.com/a")});
  it("creates new runs on public contract 1.3",()=>{const run=api.createRun("合同版本测试","semiconductor");const manifest=JSON.parse(run.manifest_json);expect(manifest.schema_version).toBe("1.3.0");expect(manifest.versions.contract).toBe("1.3.0");expect(manifest.versions.ontology).toBe("3.0.0")});
});

describe("deleteRun",()=>{
  it("removes a run and its artifacts",()=>{
    const run=api.createRun(`删除研究-${crypto.randomUUID()}`,"semiconductor");
    api.createArtifact(run.id,"stage_01",{status:"needs_review"});
    const result=api.deleteRun(run.id);
    expect(result.deleted_ids).toEqual([run.id]);
    expect(api.getRun(run.id)).toBeUndefined();
    expect(api.listArtifacts(run.id)).toHaveLength(0);
  });

  it("cascades incremental child runs",()=>{
    const parent=api.createRun(`删除父研究-${crypto.randomUUID()}`,"semiconductor");
    const child=api.createRun(parent.question,parent.domain,null,{parentRunId:parent.id});
    const grandchild=api.createRun(parent.question,parent.domain,null,{parentRunId:child.id});
    const result=api.deleteRun(parent.id);
    expect(new Set(result.deleted_ids)).toEqual(new Set([parent.id,child.id,grandchild.id]));
    expect(api.getRun(parent.id)).toBeUndefined();
    expect(api.getRun(child.id)).toBeUndefined();
    expect(api.getRun(grandchild.id)).toBeUndefined();
  });

  it("clears action proposals before work items despite RESTRICT",()=>{
    const run=api.createRun(`删除Action研究-${crypto.randomUUID()}`,"semiconductor");
    const artifact=api.createArtifact(run.id,"stage_03",{status:"needs_review"});
    const item=api.upsertWorkItem({
      run_id:run.id,
      kind:"evidence_review",
      stage:"stage_03",
      target_type:"EvidenceDraft",
      target_id:"EV-1",
      title:"待删工作项",
      priority:"medium",
      reason:"",
      source_event_id:null,
      artifact_id:artifact.id,
      attempt:artifact.version,
      payload_json:"{}",
    });
    api.createActionProposalRecord({
      id:crypto.randomUUID(),
      run_id:run.id,
      action_id:"RegisterSource",
      parameters_json:"{}",
      expected_graph_version:1,
      proposal_json:"{}",
      work_item_id:item.id,
    });
    expect(()=>api.deleteRun(run.id)).not.toThrow();
    expect(api.getRun(run.id)).toBeUndefined();
    expect(api.getWorkItem(item.id)).toBeUndefined();
  });
});
