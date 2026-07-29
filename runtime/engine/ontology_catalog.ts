import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";

export const ONTOLOGY_MODEL_REGISTRY_FILE = "ontology/01_通用/model_registry.yaml";

const modelRegistry = YAML.parse(
  readFileSync(repositoryPath(ONTOLOGY_MODEL_REGISTRY_FILE), "utf8"),
) as Record<string, unknown>;
if (
  modelRegistry.schema_name !== "ontology_model_registry"
  || modelRegistry.status !== "active"
  || !Array.isArray(modelRegistry.model_files)
) {
  throw new Error("正式本体模型注册表非法");
}
export const ONTOLOGY_MODEL_FILES: readonly string[] = Object.freeze(
  modelRegistry.model_files.map((file) => String(file).replace(/^models\//, "")),
);

export type OntologyStatus = "draft" | "active" | "deprecated";

export type OntologyAttributeDefinition = {
  type?: string;
  required?: boolean;
  cardinality?: string;
  allowed_values?: string[];
  reference_target?: string;
  [key: string]: unknown;
};

export type OntologyElementDefinition = {
  id: string;
  source_file: string;
  section: "object_types" | "relation_types" | "rules" | "scenario_types" | "evidence_constraints";
  metadata?: {
    id?: string;
    namespace?: string;
    label_zh?: string;
    label_en?: string;
    definition?: string;
    version?: string;
    status?: OntologyStatus;
    [key: string]: unknown;
  };
  attributes?: Record<string, OntologyAttributeDefinition>;
  properties?: Record<string, OntologyAttributeDefinition>;
  source_types?: string[];
  target_types?: string[];
  extends?: string;
  projects_to?: string;
  [key: string]: unknown;
};

export type OntologyCatalog = {
  schema_version: string;
  fingerprint: string;
  model_versions: Record<string, string>;
  object_types: Map<string, OntologyElementDefinition>;
  relation_types: Map<string, OntologyElementDefinition>;
  rules: Map<string, OntologyElementDefinition>;
  scenario_types: Map<string, OntologyElementDefinition>;
};

let cached: OntologyCatalog | null = null;
let cachedSemiconductorBusinessObjectIds: Set<string> | null = null;

function elementStatus(definition: OntologyElementDefinition): OntologyStatus {
  return definition.metadata?.status || "active";
}

function registerUnique(
  target: Map<string, OntologyElementDefinition>,
  id: string,
  definition: Record<string, unknown>,
  sourceFile: string,
  section: OntologyElementDefinition["section"],
) {
  const prior = target.get(id);
  if (prior) {
    throw new Error(`正式本体语义 ID 重复: ${id} (${prior.source_file}, ${sourceFile})`);
  }
  target.set(id, {
    ...definition,
    id,
    source_file: sourceFile,
    section,
  } as OntologyElementDefinition);
}

/**
 * Runtime 读取正式本体的唯一入口。
 *
 * 业务模块不得各自重新扫描 models/*.yaml；它们只能从本目录取得对象、关系、
 * 规则、枚举与版本指纹。公共合同和 Runtime Supported Profile 仍保留各自边界，
 * 不会被伪装成正式本体。
 */
export function loadOntologyCatalog(): OntologyCatalog {
  if (cached) return cached;

  const objectTypes = new Map<string, OntologyElementDefinition>();
  const relationTypes = new Map<string, OntologyElementDefinition>();
  const rules = new Map<string, OntologyElementDefinition>();
  const scenarioTypes = new Map<string, OntologyElementDefinition>();
  const modelVersions: Record<string, string> = {};
  const fingerprint = createHash("sha256");

  for (const file of ONTOLOGY_MODEL_FILES) {
    const sourceFile = `ontology/01_通用/models/${file}`;
    const rawText = readFileSync(repositoryPath(sourceFile), "utf8");
    const document = YAML.parse(rawText) as Record<string, unknown>;
    fingerprint.update(sourceFile);
    fingerprint.update("\0");
    fingerprint.update(rawText);
    fingerprint.update("\0");
    modelVersions[sourceFile] = String(document.schema_version || "");

    for (const [id, definition] of Object.entries((document.object_types || {}) as Record<string, Record<string, unknown>>)) {
      registerUnique(objectTypes, id, definition, sourceFile, "object_types");
    }
    for (const [id, definition] of Object.entries((document.relation_types || {}) as Record<string, Record<string, unknown>>)) {
      registerUnique(relationTypes, id, definition, sourceFile, "relation_types");
    }
    for (const [id, definition] of Object.entries((document.rules || {}) as Record<string, Record<string, unknown>>)) {
      registerUnique(rules, id, definition, sourceFile, "rules");
    }
    for (const [id, definition] of Object.entries((document.evidence_constraints || {}) as Record<string, Record<string, unknown>>)) {
      registerUnique(rules, id, definition, sourceFile, "evidence_constraints");
    }
    for (const [id, definition] of Object.entries((document.scenario_types || {}) as Record<string, Record<string, unknown>>)) {
      registerUnique(scenarioTypes, id, definition, sourceFile, "scenario_types");
    }
  }

  cached = {
    schema_version: "1.0.0",
    fingerprint: `sha256:${fingerprint.digest("hex")}`,
    model_versions: modelVersions,
    object_types: objectTypes,
    relation_types: relationTypes,
    rules,
    scenario_types: scenarioTypes,
  };
  return cached;
}

export function activeOntologyObjects() {
  return [...loadOntologyCatalog().object_types.values()].filter((item) => elementStatus(item) === "active");
}

export function activeOntologyRelations() {
  return [...loadOntologyCatalog().relation_types.values()].filter((item) => elementStatus(item) === "active");
}

export function ontologyEnumValues(objectType: string, attribute: string): string[] {
  const definition = loadOntologyCatalog().object_types.get(objectType);
  if (!definition) throw new Error(`正式本体未定义对象类型 ${objectType}`);
  const field = (definition.attributes || definition.properties || {})[attribute];
  if (!field) throw new Error(`正式本体未定义属性 ${objectType}.${attribute}`);
  if (field.type !== "enum" || !Array.isArray(field.allowed_values) || !field.allowed_values.length) {
    throw new Error(`${objectType}.${attribute} 不是带 allowed_values 的正式本体枚举`);
  }
  return [...field.allowed_values].map(String);
}

export function loadSemiconductorBusinessObjectIds(): Set<string> {
  if (cachedSemiconductorBusinessObjectIds) return new Set(cachedSemiconductorBusinessObjectIds);
  const document = YAML.parse(
    readFileSync(
      repositoryPath("ontology", "02_领域", "semiconductor", "business_instances.yaml"),
      "utf8",
    ),
  ) as Record<string, any>;
  const graph = document?.schema_name === "ontology_business_instance_graph"
    ? document
    : document?.business_instance_graph;
  cachedSemiconductorBusinessObjectIds = new Set(
    (Array.isArray(graph?.objects) ? graph.objects : [])
      .map((object: Record<string, unknown>) => String(object?.id || "").trim())
      .filter(Boolean),
  );
  return new Set(cachedSemiconductorBusinessObjectIds);
}

export function resetOntologyCatalogForTests() {
  cached = null;
  cachedSemiconductorBusinessObjectIds = null;
}
