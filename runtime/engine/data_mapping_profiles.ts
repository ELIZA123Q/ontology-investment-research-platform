import "server-only";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import { loadOntologyCatalog, type OntologyCatalog, type OntologyAttributeDefinition } from "./ontology_catalog";

export type DataMappingField = {
  target_attribute: string;
  source_paths: string[];
  transform: string;
};

export type DataTargetMapping = {
  target_type: string;
  materialization: "candidate_only" | "requires_context" | "ready";
  identity_source_paths: string[];
  fields: DataMappingField[];
  required_context_bindings: string[];
  completeness_gate: string[];
};

export type DataMappingProfile = {
  id: string;
  version: string;
  status: "active" | "deprecated";
  connector: string;
  source_grain: string;
  description: string;
  target_mappings: DataTargetMapping[];
  forbidden_direct_targets: string[];
};

export type DataMappingRegistry = {
  schema_name: "ontology_data_mapping_registry";
  schema_version: string;
  formal_ontology_version: string;
  required_provenance_fields: string[];
  required_connectors: string[];
  profiles: DataMappingProfile[];
  profile_by_connector: Map<string, DataMappingProfile>;
};

let cached: DataMappingRegistry | null = null;

export function loadDataMappingRegistry(): DataMappingRegistry {
  if (cached) return cached;
  const document = YAML.parse(readFileSync(
    repositoryPath("governance", "02_合同", "ontology_data_mapping_profiles.yaml"),
    "utf8",
  )) as Record<string, any>;
  if (document.schema_name !== "ontology_data_mapping_registry" || document.status !== "active") {
    throw new Error("外部数据映射注册表缺少正确的 schema_name/status");
  }
  const catalog = loadOntologyCatalog();
  const profiles = (Array.isArray(document.profiles) ? document.profiles : [])
    .map(normalizeProfile);
  const ids = new Set<string>();
  const connectors = new Set<string>();
  for (const profile of profiles) {
    if (!profile.id || !profile.version || !profile.connector || !profile.source_grain) {
      throw new Error("数据映射 Profile 缺少 id/version/connector/source_grain");
    }
    const identity = `${profile.id}@${profile.version}`;
    if (ids.has(identity)) throw new Error(`数据映射 Profile 重复: ${identity}`);
    ids.add(identity);
    if (profile.status === "active" && connectors.has(profile.connector)) {
      throw new Error(`连接器存在多个 active 数据映射 Profile: ${profile.connector}`);
    }
    if (profile.status === "active") connectors.add(profile.connector);
    for (const target of profile.target_mappings) {
      const definition = catalog.object_types.get(target.target_type);
      if (!definition || definition.metadata?.status === "deprecated") {
        throw new Error(`${identity} 引用了未激活的本体对象 ${target.target_type}`);
      }
      const attributes = inheritedOntologyAttributes(catalog, target.target_type);
      const mapped = new Set(target.fields.map((field) => field.target_attribute));
      for (const field of target.fields) {
        if (!attributes[field.target_attribute]) {
          throw new Error(`${identity} 映射到不存在的属性 ${target.target_type}.${field.target_attribute}`);
        }
        if (!field.source_paths.length || !field.transform) {
          throw new Error(`${identity} 的 ${target.target_type}.${field.target_attribute} 缺少来源路径或转换`);
        }
      }
      for (const required of target.completeness_gate) {
        if (!mapped.has(required)) {
          throw new Error(`${identity} 完整性门槛引用未映射属性 ${target.target_type}.${required}`);
        }
      }
      if (target.materialization === "ready") {
        for (const [attribute, config] of Object.entries(attributes)) {
          if (config.required && !mapped.has(attribute)) {
            throw new Error(`${identity} 声明 ready 但未映射必填属性 ${target.target_type}.${attribute}`);
          }
        }
      }
    }
    for (const forbidden of profile.forbidden_direct_targets) {
      if (!catalog.object_types.has(forbidden)) {
        throw new Error(`${identity} 的 forbidden_direct_targets 引用了未知本体对象 ${forbidden}`);
      }
    }
  }
  const requiredProvenance = (document.required_provenance_fields || []).map(String);
  const mandatoryProvenance = [
    "connector",
    "response_fingerprint",
    "mapping_profile_id",
    "mapping_profile_version",
    "field_lineage_note",
  ];
  for (const field of mandatoryProvenance) {
    if (!requiredProvenance.includes(field)) throw new Error(`数据映射注册表缺少必填血缘字段 ${field}`);
  }
  const requiredConnectors: string[] = (document.required_connectors || []).map(String);
  if (!requiredConnectors.length || requiredConnectors.length !== new Set(requiredConnectors).size) {
    throw new Error("数据映射注册表 required_connectors 必须为非空且不重复");
  }
  const activeConnectors = new Set(profiles
    .filter((profile) => profile.status === "active")
    .map((profile) => profile.connector));
  const missingConnectors = requiredConnectors.filter((connector) => !activeConnectors.has(connector));
  const undeclaredConnectors = [...activeConnectors].filter((connector) => !requiredConnectors.includes(connector));
  if (missingConnectors.length || undeclaredConnectors.length) {
    throw new Error(
      `数据映射连接器覆盖不完整；缺少=${missingConnectors.join(",") || "<无>"}，未声明=${undeclaredConnectors.join(",") || "<无>"}`,
    );
  }
  cached = {
    schema_name: "ontology_data_mapping_registry",
    schema_version: String(document.schema_version || ""),
    formal_ontology_version: String(document.formal_ontology_version || ""),
    required_provenance_fields: requiredProvenance,
    required_connectors: requiredConnectors,
    profiles,
    profile_by_connector: new Map(
      profiles.filter((profile) => profile.status === "active").map((profile) => [profile.connector, profile]),
    ),
  };
  return cached;
}

function inheritedOntologyAttributes(
  catalog: OntologyCatalog,
  objectType: string,
  visiting = new Set<string>(),
): Record<string, OntologyAttributeDefinition> {
  if (visiting.has(objectType)) throw new Error(`正式本体对象继承存在环: ${[...visiting, objectType].join(" -> ")}`);
  const definition = catalog.object_types.get(objectType);
  if (!definition) return {};
  const nextVisiting = new Set(visiting).add(objectType);
  const inherited: Record<string, OntologyAttributeDefinition> = {};
  for (const parent of [definition.extends, definition.projects_to]) {
    if (typeof parent !== "string" || !parent) continue;
    Object.assign(inherited, inheritedOntologyAttributes(catalog, parent, nextVisiting));
  }
  for (const [attribute, config] of Object.entries(definition.attributes || definition.properties || {})) {
    if (attribute === "<<") continue;
    inherited[attribute] = config;
  }
  return inherited;
}

export function dataMappingProfileForConnector(connector: string): DataMappingProfile | null {
  return loadDataMappingRegistry().profile_by_connector.get(connector) || null;
}

export function resetDataMappingRegistryForTests() {
  cached = null;
}

function normalizeProfile(raw: Record<string, any>): DataMappingProfile {
  return {
    id: String(raw.id || ""),
    version: String(raw.version || ""),
    status: raw.status === "deprecated" ? "deprecated" : "active",
    connector: String(raw.connector || ""),
    source_grain: String(raw.source_grain || ""),
    description: String(raw.description || ""),
    target_mappings: (Array.isArray(raw.target_mappings) ? raw.target_mappings : []).map((target: any) => ({
      target_type: String(target.target_type || ""),
      materialization: ["candidate_only", "requires_context", "ready"].includes(String(target.materialization))
        ? target.materialization
        : "candidate_only",
      identity_source_paths: (target.identity_source_paths || []).map(String),
      fields: (Array.isArray(target.fields) ? target.fields : []).map((field: any) => ({
        target_attribute: String(field.target_attribute || ""),
        source_paths: (field.source_paths || []).map(String),
        transform: String(field.transform || ""),
      })),
      required_context_bindings: (target.required_context_bindings || []).map(String),
      completeness_gate: (target.completeness_gate || []).map(String),
    })),
    forbidden_direct_targets: (raw.forbidden_direct_targets || []).map(String),
  };
}
