import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import {
  loadOntologyCatalog,
  ONTOLOGY_MODEL_FILES,
  type OntologyCatalog,
  type OntologyElementDefinition,
} from "./ontology_catalog";
import { parseJson, type Artifact } from "./types";

export type OntologyElementSnapshot = {
  id: string;
  section: OntologyElementDefinition["section"];
  signature: string;
  source_file: string;
};

export type OntologySemanticManifest = {
  ontology_fingerprint: string;
  elements: Record<string, OntologyElementSnapshot>;
};

export type OntologyElementChange = {
  id: string;
  section: OntologyElementDefinition["section"];
  kind: "added" | "removed" | "changed";
  previous_signature: string | null;
  current_signature: string | null;
};

export type OntologyImpactReport = {
  changed: boolean;
  previous_fingerprint: string;
  current_fingerprint: string;
  changes: OntologyElementChange[];
  affected_consumers: Array<{
    id: string;
    changed_element_ids: string[];
    paths: string[];
    required_checks: string[];
  }>;
  required_checks: string[];
};

type ConsumerDefinition = {
  id: string;
  watches: OntologyElementDefinition["section"][];
  paths: string[];
  required_checks: string[];
};

export function buildOntologySemanticManifest(
  catalog: OntologyCatalog = loadOntologyCatalog(),
): OntologySemanticManifest {
  const elements: Record<string, OntologyElementSnapshot> = {};
  for (const collection of [
    catalog.object_types,
    catalog.relation_types,
    catalog.rules,
    catalog.scenario_types,
  ]) {
    for (const definition of collection.values()) {
      const key = `${definition.section}:${definition.id}`;
      elements[key] = {
        id: definition.id,
        section: definition.section,
        signature: semanticSignature(definition),
        source_file: definition.source_file,
      };
    }
  }
  return { ontology_fingerprint: catalog.fingerprint, elements };
}

export function buildOntologySemanticManifestFromModelSources(
  sources: Record<string, string>,
): OntologySemanticManifest {
  const collections = {
    object_types: new Map<string, OntologyElementDefinition>(),
    relation_types: new Map<string, OntologyElementDefinition>(),
    rules: new Map<string, OntologyElementDefinition>(),
    scenario_types: new Map<string, OntologyElementDefinition>(),
  };
  const fingerprint = createHash("sha256");
  for (const file of ONTOLOGY_MODEL_FILES) {
    const sourceFile = `ontology/01_通用/models/${file}`;
    const rawText = sources[sourceFile];
    if (rawText === undefined) throw new Error(`本体影响分析缺少模型源文件 ${sourceFile}`);
    fingerprint.update(sourceFile);
    fingerprint.update("\0");
    fingerprint.update(rawText);
    fingerprint.update("\0");
    const document = YAML.parse(rawText) as Record<string, any>;
    for (const section of ["object_types", "relation_types", "rules", "scenario_types"] as const) {
      for (const [id, raw] of Object.entries<Record<string, unknown>>(document[section] || {})) {
        if (collections[section].has(id)) throw new Error(`历史本体语义 ID 重复: ${id}`);
        collections[section].set(id, {
          ...raw,
          id,
          source_file: sourceFile,
          section,
        } as OntologyElementDefinition);
      }
    }
    for (const [id, raw] of Object.entries<Record<string, unknown>>(document.evidence_constraints || {})) {
      if (collections.rules.has(id)) throw new Error(`历史本体语义 ID 重复: ${id}`);
      collections.rules.set(id, {
        ...raw,
        id,
        source_file: sourceFile,
        section: "evidence_constraints",
      } as OntologyElementDefinition);
    }
  }
  return buildOntologySemanticManifest({
    schema_version: "1.0.0",
    fingerprint: `sha256:${fingerprint.digest("hex")}`,
    model_versions: {},
    ...collections,
  });
}

export function analyzeOntologyImpact(
  previous: OntologySemanticManifest,
  current: OntologySemanticManifest = buildOntologySemanticManifest(),
  consumers = loadOntologyConsumers(),
): OntologyImpactReport {
  const keys = new Set([...Object.keys(previous.elements), ...Object.keys(current.elements)]);
  const changes: OntologyElementChange[] = [];
  for (const key of [...keys].sort()) {
    const before = previous.elements[key];
    const after = current.elements[key];
    if (!before && after) {
      changes.push({
        id: after.id,
        section: after.section,
        kind: "added",
        previous_signature: null,
        current_signature: after.signature,
      });
    } else if (before && !after) {
      changes.push({
        id: before.id,
        section: before.section,
        kind: "removed",
        previous_signature: before.signature,
        current_signature: null,
      });
    } else if (before && after && before.signature !== after.signature) {
      changes.push({
        id: after.id,
        section: after.section,
        kind: "changed",
        previous_signature: before.signature,
        current_signature: after.signature,
      });
    }
  }
  const affectedConsumers = consumers
    .map((consumer) => {
      const matches = changes.filter((change) => consumer.watches.includes(change.section));
      return matches.length
        ? {
            id: consumer.id,
            changed_element_ids: [...new Set(matches.map((change) => change.id))].sort(),
            paths: consumer.paths,
            required_checks: consumer.required_checks,
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    changed: changes.length > 0,
    previous_fingerprint: previous.ontology_fingerprint,
    current_fingerprint: current.ontology_fingerprint,
    changes,
    affected_consumers: affectedConsumers,
    required_checks: [...new Set(affectedConsumers.flatMap((consumer) => consumer.required_checks))].sort(),
  };
}

export function affectedRunsByOntologyFingerprint(
  artifacts: Artifact[],
  currentFingerprint = loadOntologyCatalog().fingerprint,
) {
  const affected = new Map<string, {
    run_id: string;
    artifact_ids: string[];
    ontology_fingerprints: string[];
  }>();
  for (const artifact of artifacts) {
    const data = parseJson<Record<string, any>>(artifact.json_content, {});
    const fingerprint = String(data.semantic_context?.ontology_fingerprint || "");
    if (!fingerprint || fingerprint === currentFingerprint) continue;
    const entry = affected.get(artifact.run_id) || {
      run_id: artifact.run_id,
      artifact_ids: [],
      ontology_fingerprints: [],
    };
    entry.artifact_ids.push(artifact.id);
    if (!entry.ontology_fingerprints.includes(fingerprint)) entry.ontology_fingerprints.push(fingerprint);
    affected.set(artifact.run_id, entry);
  }
  return [...affected.values()].sort((left, right) => left.run_id.localeCompare(right.run_id));
}

export function loadOntologyConsumers(): ConsumerDefinition[] {
  const document = YAML.parse(readFileSync(
    repositoryPath("governance", "02_合同", "ontology_consumer_registry.yaml"),
    "utf8",
  )) as Record<string, any>;
  if (document.schema_name !== "ontology_consumer_registry" || document.status !== "active") {
    throw new Error("本体消费面注册表缺少正确的 schema_name/status");
  }
  const ids = new Set<string>();
  return (Array.isArray(document.consumers) ? document.consumers : []).map((raw: any) => {
    const consumer: ConsumerDefinition = {
      id: String(raw.id || ""),
      watches: (raw.watches || []).map(String),
      paths: (raw.paths || []).map(String),
      required_checks: (raw.required_checks || []).map(String),
    };
    if (!consumer.id || ids.has(consumer.id)) throw new Error(`本体消费面 ID 为空或重复: ${consumer.id}`);
    ids.add(consumer.id);
    if (!consumer.watches.length || !consumer.paths.length || !consumer.required_checks.length) {
      throw new Error(`${consumer.id} 缺少 watches/paths/required_checks`);
    }
    return consumer;
  });
}

function semanticSignature(definition: OntologyElementDefinition): string {
  const semantic = {
    id: definition.id,
    section: definition.section,
    metadata: definition.metadata,
    attributes: definition.attributes || definition.properties || {},
    source_types: definition.source_types || [],
    target_types: definition.target_types || [],
    extends: definition.extends || null,
    projects_to: definition.projects_to || null,
    constraints: definition.constraints || {},
    enforcement: definition.enforcement || null,
    conditions: definition.conditions || [],
    outcome: definition.outcome || null,
  };
  return `sha256:${createHash("sha256").update(stableJson(semantic)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
