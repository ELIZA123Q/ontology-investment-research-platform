import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runtimeRoot = path.join(repositoryRoot, "runtime");

function read(relative: string) {
  return readFileSync(path.join(repositoryRoot, relative), "utf8");
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

const violations: string[] = [];
const checks: Record<string, unknown> = {};

const registry = YAML.parse(read("ontology/01_通用/model_registry.yaml")) as Record<string, unknown>;
const modelFiles = Array.isArray(registry.model_files) ? registry.model_files.map(String) : [];
if (
  registry.schema_name !== "ontology_model_registry"
  || registry.status !== "active"
  || !modelFiles.length
  || modelFiles.length !== new Set(modelFiles).size
) {
  violations.push("ontology model_registry 非法、为空或重复");
}
for (const file of modelFiles) {
  try {
    read(`ontology/01_通用/${file}`);
  } catch {
    violations.push(`model_registry 文件不存在: ${file}`);
  }
}
checks.model_registry = { files: modelFiles.length, status: violations.length ? "fail" : "pass" };

const runtimeProductionFiles = filesUnder(runtimeRoot)
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .filter((file) => !file.includes("/tests/") && !file.includes("/node_modules/"));
const allowedDirectModelReferences = new Set([
  "engine/ontology_catalog.ts",
  "engine/ontology_impact.ts",
  "engine/ontology_tools.ts",
  "scripts/analyze-ontology-impact.ts",
  "scripts/generate-ontology-vocabulary.ts",
  "scripts/verify_standards.ts",
  "scripts/audit-semantic-single-source.ts",
]);
const directModelReaders: string[] = [];
for (const absolute of runtimeProductionFiles) {
  const relative = path.relative(runtimeRoot, absolute).split(path.sep).join("/");
  const source = readFileSync(absolute, "utf8");
  if (
    source.includes("ontology/01_通用/models")
    && !allowedDirectModelReferences.has(relative)
    && relative !== "engine/ontology_vocabulary.generated.ts"
  ) {
    directModelReaders.push(relative);
  }
  if (/const\s+JUDGMENT_TYPE_OPTIONS\s*=\s*\[/.test(source)) {
    violations.push(`${relative} 手写 judgment_type 选项，必须从生成词表投影`);
  }
}
if (directModelReaders.length) {
  violations.push(`存在绕过 ontology_catalog/model_registry 的本体模型读取: ${directModelReaders.join(", ")}`);
}
checks.runtime_model_access = {
  direct_readers: directModelReaders,
  allowed_infrastructure_readers: [...allowedDirectModelReferences].sort(),
};

const mapping = YAML.parse(read("governance/contracts/ontology_data_mapping_profiles.yaml")) as Record<string, any>;
const requiredConnectors: string[] = (mapping.required_connectors || []).map(String);
const activeConnectors: string[] = (mapping.profiles || [])
  .filter((profile: Record<string, unknown>) => profile.status === "active")
  .map((profile: Record<string, unknown>) => String(profile.connector));
const mcpSource = read("runtime/skills/financial_data/mcp_registry.ts");
const channelBlock = mcpSource.match(/EVIDENCE_MCP_CHANNELS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] || "";
const wiredConnectors = [...channelBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const connectorMissing = wiredConnectors.filter((connector) => !activeConnectors.includes(connector));
const connectorExtra = activeConnectors.filter((connector) => !wiredConnectors.includes(connector));
if (
  connectorMissing.length
  || connectorExtra.length
  || [...requiredConnectors].sort().join("|") !== [...wiredConnectors].sort().join("|")
) {
  violations.push(`Stage03 连接器与映射注册表漂移；缺少=${connectorMissing.join(",") || "<无>"}，多余=${connectorExtra.join(",") || "<无>"}`);
}
checks.external_mapping = {
  wired: wiredConnectors.length,
  registered: activeConnectors.length,
  required: requiredConnectors.length,
  missing: connectorMissing,
  extra: connectorExtra,
};

const requiredMarkers: Array<[string, string, string]> = [
  ["runtime/workflow/orchestrator.ts", "buildStageSemanticContext", "生成阶段语义封套"],
  ["runtime/workflow/approval.ts", "buildStageSemanticContext", "批准阶段语义封套"],
  ["runtime/export/formal_pack_export.ts", "buildProductionSemanticBaseline", "生产正式发布语义基线"],
  ["governance/03_校验/validate_run.py", "validate_semantic_baseline", "正式发布 Python 语义门"],
  ["runtime/governance/ontology_changes/action_executor.ts", "assertFormalRelationChoice", "关系写入正式端点门"],
  ["runtime/skills/ontology/semantic_reads.ts", "formal_graph_verified", "已批准阶段语义读取门"],
];
const missingMarkers = requiredMarkers
  .filter(([file, marker]) => !read(file).includes(marker))
  .map(([file, , label]) => `${label}:${file}`);
if (missingMarkers.length) violations.push(`统一语义基础设施关键接线缺失: ${missingMarkers.join(", ")}`);
checks.required_runtime_wiring = {
  checked: requiredMarkers.length,
  missing: missingMarkers,
};

const directApprovedReads = runtimeProductionFiles.flatMap((absolute) => {
  const relative = path.relative(runtimeRoot, absolute).split(path.sep).join("/");
  const source = readFileSync(absolute, "utf8");
  const count = [...source.matchAll(/latestArtifact\([^\n]*["']stage_0[234]["'][^\n]*\["approved"\]/g)].length;
  return count ? [{ file: relative, count }] : [];
});
checks.approved_stage_read_audit = {
  direct_reads: directApprovedReads,
  policy: "生命周期、生成编排和兼容投影可持有 Artifact；发布、评价、雷达与治理查询必须经过 semantic_reads。",
  guarded_consumers: [
    "adapters/publish_package.ts",
    "app/api/runs/[id]/evaluation/route.ts",
    "app/api/runs/[id]/evaluation/recompute-metrics/route.ts",
    "engine/market_radar.ts",
    "engine/knowledge_browser.ts",
    "engine/formal_pack_export.ts",
  ],
};

const result = {
  ok: violations.length === 0,
  schema_name: "semantic_single_source_audit",
  schema_version: "1.0.0",
  checks,
  violations,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (violations.length) process.exitCode = 1;
