const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("90_compat/instances/00_本机运行/workbench.sqlite");
function get(runId, kind){
  const a = db.prepare(`SELECT json_content FROM artifacts WHERE run_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`).get(runId, kind);
  return a && a.json_content ? JSON.parse(a.json_content) : null;
}
const runId="3f15bd4a-3662-4183-a5c8-e3336f98565c";
const s1 = get(runId, "stage_01");
console.log("=== stage_01 keys:", Object.keys(s1||{}).join(","));
if(s1){
  console.log("  core_object:", s1.core_object);
  console.log("  normalized_question:", String(s1.normalized_question||"").slice(0,60));
  for(const k of ["system_understanding","research_focus","main_judgment_axis","resolution"]){
    if(s1[k]!=null) console.log("  ",k,":",JSON.stringify(s1[k]).slice(0,160));
  }
}
