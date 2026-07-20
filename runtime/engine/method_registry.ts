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

export function defaultMethodIdsForJudgmentType(judgmentType: string) {
  const routeRegistry = parseYaml("governance/02_合同/judgment_method_routes.yaml");
  const route = routeRegistry.routes?.[judgmentType];
  if (!route?.default_kb03_method || !route?.default_kb04_method) {
    throw new Error(`判断类型 ${judgmentType} 没有登记默认取证/裁决方法`);
  }
  const structureByType: Record<string, string> = {
    state_measurement: "BF-SD-01",
    trend_direction: "BF-SD-01",
    cycle_phase: "BF-SD-01",
    mechanism_validation: "BF-VT-01",
    causal_attribution: "BF-VT-01",
    transmission_path: "BF-VT-01",
    object_differentiation: "BF-IC-01",
    impact_realization: "BF-EE-01",
    expectation_gap: "BF-EG-01",
    valuation_impact: "BF-VA-01",
  };
  const structure = structureByType[judgmentType];
  if (!structure) throw new Error(`判断类型 ${judgmentType} 没有登记默认结构方法`);
  return {
    judgment_structure: structure,
    evidence: String(route.default_kb03_method),
    adjudication: String(route.default_kb04_method),
  };
}

export function recallRegisteredMethodCandidates(taskText: string) {
  const text = taskText.toLowerCase();
  const types = new Set<string>();
  const matches = (pattern: RegExp) => pattern.test(text);
  if (matches(/同比|环比|增长|增速|趋势|上升|下降|改善|恶化|trend|growth|yoy|mom/)) types.add("trend_direction");
  if (matches(/周期|阶段|去库|补库|cycle|phase/)) types.add("cycle_phase");
  if (matches(/机制|为何|原因|归因|驱动|cause|attribut|driver/)) types.add("causal_attribution");
  if (matches(/传导|路径|影响到|pass.through|transmission/)) types.add("transmission_path");
  if (matches(/(?:对象|产品|公司|地区).*(?:对比|比较|分化|不同)|(?:对比|比较|分化|不同).*(?:对象|产品|公司|地区)|object differentiation/)) types.add("object_differentiation");
  if (matches(/实现影响|业绩影响|利润影响|impact|earnings effect/)) types.add("impact_realization");
  if (matches(/预期差|一致预期|priced.in|expectation gap|consensus/)) types.add("expectation_gap");
  if (matches(/估值|valuation|multiple|pe\b|pb\b/)) types.add("valuation_impact");
  if (matches(/机制是否|mechanism validation/)) types.add("mechanism_validation");
  if (!types.size || matches(/是否|状态|数值|事实|营收|收入|利润|毛利|state|revenue|financial/)) types.add("state_measurement");

  const routeRegistry = parseYaml("governance/02_合同/judgment_method_routes.yaml");
  const methodIds = new Set<string>(routeRegistry.global_optional_reasoning_methods || []);
  for (const type of types) {
    const route = routeRegistry.routes?.[type] || {};
    for (const id of [
      ...(route.allowed_kb03_methods || []),
      ...(route.allowed_kb04_methods || []),
      ...(route.optional_auxiliary_methods || []),
    ]) methodIds.add(String(id));
  }

  const financial = matches(/营收|收入|利润|毛利|财务|报表|revenue|income|margin|financial/);
  const structureByType: Record<string, string[]> = {
    state_measurement: financial ? ["BF-FQ-01"] : ["BF-SD-01"],
    trend_direction: financial ? ["BF-FQ-01"] : ["BF-SD-01"],
    cycle_phase: ["BF-SD-01"],
    mechanism_validation: ["BF-VT-01"],
    causal_attribution: ["BF-VT-01"],
    transmission_path: ["BF-VT-01"],
    object_differentiation: financial ? ["BF-FQ-01"] : ["BF-IC-01"],
    impact_realization: ["BF-EE-01"],
    expectation_gap: ["BF-EG-01"],
    valuation_impact: ["BF-VA-01"],
  };
  for (const type of types) for (const id of structureByType[type] || []) methodIds.add(id);

  const registry = loadMethodRegistry();
  const recalled = [...methodIds].map((id) => registry.get(id)).filter(Boolean) as RegisteredMethod[];
  const capabilities = new Set(recalled.map((item) => item.capability_type));
  if (!["judgment_structure", "evidence", "adjudication"].every((capability) => capabilities.has(capability as MethodCapabilityType))) {
    return registeredMethodCandidates();
  }
  return recalled.sort((a, b) => a.method_id.localeCompare(b.method_id));
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
