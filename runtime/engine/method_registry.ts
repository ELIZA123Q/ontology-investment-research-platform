import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { MethodApplication, MethodCapabilityType } from "./types";

export type RegisteredMethod = {
  method_id: string;
  method_version: string;
  capability_type: MethodCapabilityType;
  file: string | null;
};

type MethodAssetRegistry = {
  groups?: Record<string, {
    version?: string;
    registry_ref?: string;
    methods?: Array<{ id: string; file?: string }>;
  }>;
};

function parseYaml(path: string) {
  return YAML.parse(readFileSync(repositoryPath(path), "utf8")) as any;
}

export function loadMethodRegistry(): Map<string, RegisteredMethod> {
  const root = parseYaml("methods/00_登记/method_assets.yaml") as MethodAssetRegistry;
  const result = new Map<string, RegisteredMethod>();
  const groups = root.groups || {};

  const structure = groups.judgment_structure;
  if (structure?.registry_ref) {
    const registry = parseYaml(structure.registry_ref);
    for (const methodId of [
      ...Object.keys(registry.frameworks || {}),
      ...Object.keys(registry.industry_overlays || {}),
    ]) {
      result.set(methodId, {
        method_id: methodId,
        method_version: String(structure.version),
        capability_type: "judgment_structure",
        file: structure.registry_ref,
      });
    }
  }

  const evidence = groups.evidence;
  if (evidence?.registry_ref) {
    const registry = parseYaml(evidence.registry_ref);
    for (const [localId, method] of Object.entries<any>(registry.methods || {})) {
      const methodId = `kb03:${localId}`;
      result.set(methodId, {
        method_id: methodId,
        method_version: String(evidence.version),
        capability_type: "evidence",
        file: method.file ? `methods/03_取证/${method.file}` : evidence.registry_ref,
      });
    }
  }

  const adjudication = groups.adjudication;
  for (const method of adjudication?.methods || []) {
    result.set(method.id, {
      method_id: method.id,
      method_version: String(adjudication?.version),
      capability_type: "adjudication",
      file: method.file || null,
    });
  }
  return result;
}

export function registeredMethodCandidates() {
  return [...loadMethodRegistry().values()].sort((a, b) => a.method_id.localeCompare(b.method_id));
}

export function validateRegisteredMethodApplications(applications: MethodApplication[]) {
  const registry = loadMethodRegistry();
  for (const application of applications) {
    const registered = registry.get(application.method_id);
    if (!registered) throw new Error(`${application.application_id} 引用了未登记方法 ${application.method_id}`);
    if (registered.method_version !== application.method_version) {
      throw new Error(
        `${application.application_id} 方法版本不匹配: ${application.method_id} `
        + `登记为 ${registered.method_version}，实际为 ${application.method_version}`,
      );
    }
    if (registered.capability_type !== application.capability_type) {
      throw new Error(
        `${application.application_id} 能力类型不匹配: ${application.method_id} `
        + `应为 ${registered.capability_type}，实际为 ${application.capability_type}`,
      );
    }
  }
}

export function validateMethodRoutes(
  applications: MethodApplication[],
  judgmentUnits: Array<{ id: string; judgment_type: string }>,
) {
  const routeRegistry = parseYaml("governance/02_合同/judgment_method_routes.yaml");
  const units = new Map(judgmentUnits.map((unit) => [unit.id, unit]));
  for (const application of applications) {
    if (application.capability_type === "judgment_structure") continue;
    for (const unitRef of application.target_judgment_unit_refs) {
      const unit = units.get(unitRef);
      if (!unit) throw new Error(`${application.application_id} 引用了不存在的判断单元 ${unitRef}`);
      const route = routeRegistry.routes?.[unit.judgment_type];
      if (!route) throw new Error(`${unitRef} 使用了未登记判断类型 ${unit.judgment_type}`);
      const allowed = application.capability_type === "evidence"
        ? route.allowed_kb03_methods || []
        : [...(route.allowed_kb04_methods || []), ...(route.optional_auxiliary_methods || [])];
      if (!allowed.includes(application.method_id)) {
        throw new Error(
          `${application.application_id} 的 ${application.method_id} 不允许用于 `
          + `${unitRef} (${unit.judgment_type})`,
        );
      }
    }
  }
}
