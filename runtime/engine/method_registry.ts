import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { MethodApplication, MethodCapabilityType } from "./types";

export type RegisteredMethod = {
  method_id: string;
  method_version: string;
  capability_type: MethodCapabilityType;
  file: string | null;
  source_ref: string;
  applicability: string | string[];
  preconditions: string[];
  inputs: string[];
  outputs: string[];
  not_applicable_when: string[];
  degrade_policy: string;
  alternatives: string[];
  counter_examples: string[];
};

type MethodAssetRegistry = {
  groups?: Record<string, {
    version?: string;
    registry_ref?: string;
    contract_projection?: Record<string, unknown>;
    methods?: Array<{
      id: string;
      file?: string;
      applicability?: string | string[];
      preconditions?: string[];
      inputs?: string[];
      outputs?: string[];
      not_applicable_when?: string[];
      degrade_policy?: string;
      alternatives?: string[];
      counter_examples?: string[];
    }>;
  }>;
};

function parseYaml(path: string) {
  return YAML.parse(readFileSync(repositoryPath(path), "utf8")) as any;
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

export function loadMethodRegistry(): Map<string, RegisteredMethod> {
  const root = parseYaml("methods/00_登记/method_assets.yaml") as MethodAssetRegistry;
  const result = new Map<string, RegisteredMethod>();
  const groups = root.groups || {};

  const structure = groups.judgment_structure;
  if (structure?.registry_ref) {
    const registry = parseYaml(structure.registry_ref);
    for (const [methodId, method] of Object.entries<any>({
      ...(registry.frameworks || {}),
      ...(registry.industry_overlays || {}),
    })) {
      const outputGates = Object.keys(method.output_gates || {});
      result.set(methodId, {
        method_id: methodId,
        method_version: String(structure.version),
        capability_type: "judgment_structure",
        file: structure.registry_ref,
        source_ref: `${structure.registry_ref}#${methodId}`,
        applicability: method.entry_requires || [],
        preconditions: method.entry_requires || [],
        inputs: method.entry_requires || [],
        outputs: outputGates,
        not_applicable_when: ["entry_requirements_unmet"],
        degrade_policy: "output_gate_failed_blocks_that_output; quality_gate_failed_caps_precision",
        alternatives: unique([
          ...(method.downstream_unlocks || []),
          ...Object.values(method.boundary_handoffs || {}),
        ]),
        counter_examples: ["attempt_output_without_gate", "cross_framework_conclusion_without_handoff"],
      });
    }
  }

  const evidence = groups.evidence;
  if (evidence?.registry_ref) {
    const registry = parseYaml(evidence.registry_ref);
    for (const [localId, method] of Object.entries<any>(registry.methods || {})) {
      const methodId = `kb03:${localId}`;
      const contract = method.contract || {};
      result.set(methodId, {
        method_id: methodId,
        method_version: String(evidence.version),
        capability_type: "evidence",
        file: method.file ? `methods/03_取证/${method.file}` : evidence.registry_ref,
        source_ref: `${evidence.registry_ref}#methods.${localId}`,
        applicability: contract.applicability || "",
        preconditions: contract.preconditions || [],
        inputs: contract.inputs || [],
        outputs: contract.outputs || [],
        not_applicable_when: contract.not_applicable_when || [],
        degrade_policy: contract.degrade_policy || "",
        alternatives: contract.alternatives || [],
        counter_examples: contract.counter_examples || [],
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
      source_ref: `methods/00_登记/method_assets.yaml#groups.adjudication.methods.${method.id}`,
      applicability: method.applicability || "",
      preconditions: method.preconditions || [],
      inputs: method.inputs || [],
      outputs: method.outputs || [],
      not_applicable_when: method.not_applicable_when || [],
      degrade_policy: method.degrade_policy || "",
      alternatives: method.alternatives || [],
      counter_examples: method.counter_examples || [],
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
  const globalOptional = routeRegistry.global_optional_reasoning_methods || [];
  const units = new Map(judgmentUnits.map((unit) => [unit.id, unit]));
  for (const application of applications) {
    if (!["selected", "executed", "degraded"].includes(application.status)) continue;
    if (application.capability_type === "judgment_structure") continue;
    for (const unitRef of application.target_judgment_unit_refs) {
      const unit = units.get(unitRef);
      if (!unit) throw new Error(`${application.application_id} 引用了不存在的判断单元 ${unitRef}`);
      const route = routeRegistry.routes?.[unit.judgment_type];
      if (!route) throw new Error(`${unitRef} 使用了未登记判断类型 ${unit.judgment_type}`);
      const allowed = application.capability_type === "evidence"
        ? route.allowed_kb03_methods || []
        : [
          ...(route.allowed_kb04_methods || []),
          ...(route.optional_auxiliary_methods || []),
          ...globalOptional,
        ];
      if (!allowed.includes(application.method_id)) {
        throw new Error(
          `${application.application_id} 的 ${application.method_id} 不允许用于 `
          + `${unitRef} (${unit.judgment_type})`,
        );
      }
    }
  }
}
