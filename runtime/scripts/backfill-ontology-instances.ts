/**
 * 修复脚本：为已有 run 回填 ontology_instances 并重建 instance_graph
 *
 * 背景：早期 Stage 02 生成的 LLM 常漏填 ontology_instances，导致实体关系图空白。
 * `ensureStage02BusinessInstances` 已修复生成侧，但存量已审批 run 不受益。
 * 本脚本直接回填 + 重建 instance_graph，使存量 run 的实体关系图恢复可渲染。
 *
 * Usage:
 *   cd runtime && npx tsx --conditions=react-server scripts/backfill-ontology-instances.ts
 */

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "..");
const dbPath = process.env.RESEARCH_WORKBENCH_DB || process.env.WORKBENCH_DB_PATH
  || resolve(repoRoot, "instances/00_本机运行/workbench.sqlite");

// ============================================================
// Step 1: 内联 ensureStage02BusinessInstances（避免 server-only 依赖）
// ============================================================

const EQUITY_CODE_RE = /([\u4e00-\u9fa5]{2,10})\s*[（(]\s*(\d{6})\s*[.)]\s*(SH|SZ|BJ)\s*[）)]/;
const PRODUCT_PHRASES = [
  "刻蚀设备", "光刻设备", "CMP设备", "薄膜设备", "半导体设备",
  "DRAM", "NAND", "HBM", "SRAM", "存储芯片", "晶圆", "碳化硅", "氮化镓",
];
const CUSTOMER_COMPANIES: Record<string, string> = {
  "中芯国际": "SMIC", "华虹": "HuaHong", "华虹半导体": "HuaHong",
  "长江存储": "YMTC", "长鑫存储": "CXMT", "合肥长鑫": "CXMT",
  "中微公司": "AMEC", "北方华创": "NAURA", "盛美上海": "ACME",
  "韦尔股份": "WillSemi", "兆易创新": "GigaDevice",
};
const KNOWN_REGIONS: Record<string, string> = {
  "中国大陆": "China-Mainland", "美国": "US", "日本": "Japan",
  "韩国": "Korea", "中国台湾": "China-Taiwan", "欧洲": "Europe",
};

function extractBusinessInstances(
  text: string,
  scopeDims?: Record<string, any>,
): Array<{ id: string; type: string; name: string; ticker?: string }> {
  const out: Array<{ id: string; type: string; name: string; ticker?: string }> = [];
  if (!text) return out;
  const m = text.match(EQUITY_CODE_RE);
  if (m) {
    const name = m[1];
    const ticker = `${m[2]}.${m[3]}`;
    out.push({ id: `company-${m[2]}`, type: "Company", name: `${name}（${ticker}）`, ticker });
  }
  if (out.length) {
    for (const phrase of PRODUCT_PHRASES) {
      if (text.includes(phrase)) {
        out.push({ id: `product-${phrase}`, type: "Product", name: phrase });
        break;
      }
    }
  }
  // 从研究范围维度提取更多业务实体
  if (scopeDims) {
    const customers = String(scopeDims.customers || "");
    for (const [name] of Object.entries(CUSTOMER_COMPANIES)) {
      if (customers.includes(name) && !out.some((c) => c.name === name)) {
        out.push({ id: `customer-${name}`, type: "Company", name });
      }
    }
    const geography = String(scopeDims.geography || "");
    for (const [name] of Object.entries(KNOWN_REGIONS)) {
      if (geography.includes(name) && !out.some((c) => c.name === name)) {
        out.push({ id: `region-${name}`, type: "Region", name });
      }
    }
    const valueChain = String(scopeDims.value_chain || "");
    if (/制造/.test(valueChain)) {
      const nm = "半导体设备制造";
      if (!out.some((c) => c.name === nm)) out.push({ id: "industry-equip-mfg", type: "Industry", name: nm });
    }
    if (/采购|晶圆厂/.test(valueChain)) {
      const nm = "晶圆制造";
      if (!out.some((c) => c.name === nm)) out.push({ id: "industry-wafer-fab", type: "Industry", name: nm });
    }
  }
  return out;
}

function applyBusinessInstances(data: any, question: string): { changed: boolean; added: string[] } {
  if (!data || typeof data !== "object") return { changed: false, added: [] };
  const scope = data.research_scope && typeof data.research_scope === "object"
    ? data.research_scope : (data.research_scope = {});
  if (!scope.id) return { changed: false, added: [] };

  const instances = Array.isArray(data.ontology_instances)
    ? data.ontology_instances : (data.ontology_instances = []);
  const coreObjects = Array.isArray(scope.core_objects)
    ? scope.core_objects : (scope.core_objects = []);

  const combined = [question, scope.label, data.judgment_spine]
    .filter((s): s is string => typeof s === "string" && Boolean(s.trim()))
    .join(" ");

  const candidates = extractBusinessInstances(combined, scope.dimensions as Record<string, any> | undefined);
  if (!candidates.length) return { changed: false, added: [] };

  const existingIds = new Set(instances.map((item: any) => String(item?.id || "")));
  const existingNames = new Set(instances.map((item: any) => String(item?.name || item?.label || "")));
  const added: string[] = [];

  for (const candidate of candidates) {
    if (existingIds.has(candidate.id) || existingNames.has(candidate.name)) continue;
    instances.push({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      ...(candidate.ticker ? { ticker: candidate.ticker } : {}),
    });
    coreObjects.push({ id: candidate.id, type: candidate.type, name: candidate.name });
    existingIds.add(candidate.id);
    existingNames.add(candidate.name);
    added.push(`${candidate.type}:${candidate.name}`);
  }

  return { changed: added.length > 0, added };
}

// ============================================================
// Step 2: 重建 instance_graph（使用引擎函数，含 generateEntityRelations）
// ============================================================

import { buildAuthorityGraphCandidate } from "../skills/ontology/instance_graph/authority";
import type { AuthorityStageInput, AuthorityGraphStage } from "../skills/ontology/instance_graph/authority";

// ============================================================
// Main
// ============================================================

function main() {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");

  const RUN_ID = "3f15bd4a-3662-4183-a5c8-e3336f98565c";
  const STAGE_02_ARTIFACT_ID = "0455f0c0-f1d7-45b1-9909-bd7f11d905fc";

  // --- 获取 run 信息 ---
  const run = db.prepare("SELECT id, question FROM research_runs WHERE id = ?").get(RUN_ID) as
    | { id: string; question: string } | undefined;
  if (!run) { console.error("Run not found:", RUN_ID); process.exit(1); }
  console.log(`Run: ${run.question.slice(0, 60)}...`);

  // --- 读取 stage_02 ---
  const stage02Row = db.prepare(
    "SELECT id, json_content FROM artifacts WHERE id = ?"
  ).get(STAGE_02_ARTIFACT_ID) as { id: string; json_content: string } | undefined;
  if (!stage02Row) { console.error("Stage 02 artifact not found:", STAGE_02_ARTIFACT_ID); process.exit(1); }

  const stage02Data = JSON.parse(stage02Row.json_content);
  console.log(`Stage 02 loaded. ontology_instances: ${stage02Data.ontology_instances?.length ?? "NULL"}`);

  // --- 应用实体提取 ---
  const { changed, added } = applyBusinessInstances(stage02Data, run.question);
  if (changed) {
    console.log(`Backfilled ontology_instances: ${added.join(", ")}`);

    // 更新 stage_02 artifact（原地更新，不改变 version/status）
    const updateResult = db.prepare(
      "UPDATE artifacts SET json_content = ? WHERE id = ?"
    ).run(JSON.stringify(stage02Data, null, 2), STAGE_02_ARTIFACT_ID);
    console.log(`Stage 02 updated: ${updateResult.changes} row(s)`);
  } else {
    console.log("ontology_instances already complete, skipped backfill");
  }

  // --- 收集所有已审批的权威阶段（02/03/04）---
  const approvedStages = db.prepare(
    `SELECT id, kind, version, json_content, approved_at
     FROM artifacts
     WHERE run_id = ? AND status = 'approved' AND kind IN ('stage_02','stage_03','stage_04')
     ORDER BY 
       CASE kind WHEN 'stage_02' THEN 1 WHEN 'stage_03' THEN 2 WHEN 'stage_04' THEN 3 END,
       version DESC`
  ).all(RUN_ID) as Array<{ id: string; kind: string; version: number; json_content: string; approved_at: string }>;

  // 每个 kind 取最新 approved 版本
  const latestByKind = new Map<string, { id: string; version: number; data: any }>();
  for (const row of approvedStages) {
    if (!latestByKind.has(row.kind)) {
      latestByKind.set(row.kind, {
        id: row.id,
        version: row.version,
        data: JSON.parse(row.json_content),
      });
    }
  }

  console.log(`Approved stages: ${[...latestByKind.keys()].join(", ")}`);

  // stage_02 用回填后的数据
  const stage02Latest = latestByKind.get("stage_02");
  if (stage02Latest) {
    stage02Latest.data = stage02Data;
  }

  // --- 构建权威图候选 ---
  const stageInputs: AuthorityStageInput[] = [];
  const expectedKinds: AuthorityGraphStage[] = ["stage_02", "stage_03", "stage_04"];
  for (const kind of expectedKinds) {
    const entry = latestByKind.get(kind);
    if (!entry) { console.warn(`Missing ${kind} approved artifact, skipping graph build`); process.exit(1); }
    stageInputs.push({
      kind,
      artifact_id: entry.id,
      artifact_version: entry.version,
      data: entry.data,
    });
  }

  console.log("Building authority graph candidate...");
  const candidate = buildAuthorityGraphCandidate(stageInputs, null);

  const businessTypes = new Set(["Company", "Product", "Technology", "Industry", "Market", "SupplyChain", "Region"]);
  const businessObjects = candidate.objects.filter((obj) => businessTypes.has(obj.type));
  const businessIds = new Set(businessObjects.map((o) => o.id));
  const businessRelations = candidate.relations.filter(
    (r) => businessIds.has(r.sourceId) && businessIds.has(r.targetId)
  );

  console.log(`Graph built: ${candidate.objects.length} objects, ${candidate.relations.length} relations`);
  console.log(`Business entities: ${businessObjects.length} (${[...new Set(businessObjects.map(o => o.type))].join(", ") || "none"})`);
  console.log(`Business relations: ${businessRelations.length}`);

  // 打印业务实体详情
  console.log("\nBusiness entities:");
  for (const obj of businessObjects) {
    console.log(`  [${obj.type}] ${obj.id}: ${(obj.properties as any)?.name || "?"}`);
  }

  // 打印业务实体间关系
  if (businessRelations.length > 0) {
    console.log("\nBusiness entity relations:");
    for (const rel of businessRelations) {
      const srcType = businessObjects.find((o) => o.id === rel.sourceId)?.type || "?";
      const tgtType = businessObjects.find((o) => o.id === rel.targetId)?.type || "?";
      const srcName = (businessObjects.find((o) => o.id === rel.sourceId)?.properties as any)?.name || rel.sourceId;
      const tgtName = (businessObjects.find((o) => o.id === rel.targetId)?.properties as any)?.name || rel.targetId;
      console.log(`  [${srcType}] ${srcName} --${rel.type}--> [${tgtType}] ${tgtName}`);
    }
  }

  // --- 保存 instance_graph ---
  const now = new Date().toISOString();
  const graphPayload = {
    schema_name: "ontology_business_instance_graph",
    schema_version: "1.0.0",
    authority: "business_parameters",
    business_instance_graph: candidate,
    authority_contract: "ontology_authority_graph_v1",
    provisional: false,
    materialized_from: "stage_04",
    materialized_from_artifact_id: latestByKind.get("stage_04")?.id,
    materialized_from_artifact_version: latestByKind.get("stage_04")?.version,
    materialized_at: now,
  };

  const maxVersion = db.prepare(
    "SELECT COALESCE(MAX(version), 0) as max_v FROM artifacts WHERE run_id = ? AND kind = 'instance_graph'"
  ).get(RUN_ID) as { max_v: number };
  const newVersion = maxVersion.max_v + 1;

  const graphId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO artifacts (id, run_id, kind, version, status, json_content, markdown_content, approved_at, created_at)
     VALUES (?, ?, 'instance_graph', ?, 'approved', ?, ?, ?, ?)`
  ).run(
    graphId, RUN_ID, newVersion,
    JSON.stringify(graphPayload, null, 2),
    `Backfilled ontology_instances: ${added.join(", ")}`,
    now, now
  );

  db.prepare(
    "UPDATE artifacts SET status = 'superseded' WHERE run_id = ? AND kind = 'instance_graph' AND id != ? AND status = 'approved'"
  ).run(RUN_ID, graphId);

  console.log(`\nNew instance_graph v${newVersion} created: ${graphId}`);
  console.log("Done!");

  db.close();
}

main();
