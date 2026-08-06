// 一次性校正脚本：为已提交但缺少业务实体的历史 instance_graph 补回本研究点名的核心标的。
// 仅针对 demo 运行 3f15bd4a（中微公司 688012.SH / 刻蚀设备）。幂等：已存在则跳过。
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("90_compat/instances/00_本机运行/workbench.sqlite");

const RUN_ID = "3f15bd4a-3662-4183-a5c8-e3336f98565c";
const COMPANY = { id: "company-688012", type: "Company", properties: { name: "中微公司（688012.SH）", ticker: "688012.SH" } };
const PRODUCT = { id: "product-刻蚀设备", type: "Product", properties: { name: "刻蚀设备" } };

const art = db.prepare(`SELECT id, version, json_content FROM artifacts WHERE run_id=? AND kind='instance_graph' ORDER BY created_at DESC LIMIT 1`).get(RUN_ID);
if (!art) { console.log("no instance_graph artifact"); process.exit(0); }
const doc = JSON.parse(art.json_content);
const graph = doc.business_instance_graph || doc;
if (!Array.isArray(graph.objects)) { console.log("no objects array"); process.exit(0); }

const existingIds = new Set(graph.objects.map((o) => o.id));
let added = 0;
for (const obj of [COMPANY, PRODUCT]) {
  if (existingIds.has(obj.id)) { console.log("skip (exists):", obj.id); continue; }
  graph.objects.push({ id: obj.id, type: obj.type, properties: obj.properties });
  added += 1;
  console.log("added:", obj.id, obj.type, obj.properties.name);
}
if (!added) { console.log("nothing to add"); process.exit(0); }

const newVersion = (Number(art.version) || 0) + 1;
const newContent = JSON.stringify(doc);
db.prepare(`UPDATE artifacts SET json_content=?, version=? WHERE id=?`).run(newContent, newVersion, art.id);
console.log("updated artifact", art.id, "-> version", newVersion, "objects:", graph.objects.length);
