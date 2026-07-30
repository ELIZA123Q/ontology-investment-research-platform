import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import { loadDomainBusinessGraph } from "./instance_graph";
import type { EvidenceRequirementProjection } from "./structure_candidates";

export type EvidenceRouteProducer = {
  name: string;
  domain: string;
  tier: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
  authority_type: "official" | "company_disclosure" | "industry_provider" | "public_secondary" | "unknown";
};

export type EvidenceSourceRoute = {
  id: string;
  domains: string[];
  evidence_profile_ids: string[];
  judgment_types: string[];
  evidence_roles: Array<"support" | "counter" | "context" | "boundary">;
  match_terms: string[];
  preferred_channels: string[];
  mcp_channels: string[];
  verification_mode: "quote_snapshot" | "structured_or_quote";
  query_card_refs: string[];
  producers: EvidenceRouteProducer[];
  query_terms: string[];
};

export type EvidenceAcquisitionTask = {
  task_id: string;
  status: "ready" | "route_missing";
  failure_detail: string | null;
  requirement_id: string;
  judgment_unit_ids: string[];
  judgment_types: string[];
  evidence_role: EvidenceRequirementProjection["evidence_role"];
  evidence_profile_ids: string[];
  evidence_recipe_ref: string | null;
  route_ids: string[];
  preferred_channels: string[];
  mcp_channels: string[];
  query_card_refs: string[];
  verification_mode: EvidenceSourceRoute["verification_mode"];
  allowed_producers: EvidenceRouteProducer[];
  queries: string[];
};

export type EvidenceAcquisitionPlan = {
  registry_version: string;
  generated_from: {
    requirement_ids: string[];
    judgment_unit_ids: string[];
    evidence_profile_ids: string[];
  };
  tasks: EvidenceAcquisitionTask[];
  gap_details: Array<{
    requirement_id: string;
    code: "route_missing";
    detail: string;
    evidence_profile_ids: string[];
  }>;
  queries: string[];
  allowed_producers: EvidenceRouteProducer[];
};

type RouteRegistry = {
  schema_version?: string;
  defaults?: {
    preferred_channels?: string[];
    verification_mode?: EvidenceSourceRoute["verification_mode"];
    max_queries_per_requirement?: number;
  };
  routes?: Array<Partial<EvidenceSourceRoute> & { id?: string }>;
};

let cachedRegistry: { version: string; routes: EvidenceSourceRoute[]; maxQueriesPerRequirement: number } | null = null;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function loadEvidenceSourceRoutes(): {
  version: string;
  routes: EvidenceSourceRoute[];
  maxQueriesPerRequirement: number;
} {
  if (cachedRegistry) return cachedRegistry;
  const raw = YAML.parse(
    readFileSync(repositoryPath("methods", "03_取证", "source_routes.yaml"), "utf8"),
  ) as RouteRegistry;
  const defaultChannels = strings(raw.defaults?.preferred_channels);
  const defaultVerification = raw.defaults?.verification_mode || "quote_snapshot";
  const routes = (raw.routes || []).flatMap((route) => {
    const id = String(route.id || "").trim();
    if (!id) return [];
    return [{
      id,
      domains: strings(route.domains),
      evidence_profile_ids: strings(route.evidence_profile_ids),
      judgment_types: strings(route.judgment_types),
      evidence_roles: strings(route.evidence_roles) as EvidenceSourceRoute["evidence_roles"],
      match_terms: strings(route.match_terms),
      preferred_channels: strings(route.preferred_channels).length
        ? strings(route.preferred_channels)
        : defaultChannels,
      mcp_channels: strings(route.mcp_channels),
      verification_mode: route.verification_mode || defaultVerification,
      query_card_refs: strings(route.query_card_refs),
      producers: Array.isArray(route.producers)
        ? route.producers.flatMap((producer) => {
          if (!producer || typeof producer !== "object") return [];
          const item = producer as EvidenceRouteProducer;
          return item.domain ? [{ ...item, domain: String(item.domain).toLowerCase() }] : [];
        })
        : [],
      query_terms: strings(route.query_terms),
    }];
  });
  cachedRegistry = {
    version: String(raw.schema_version || "unknown"),
    routes,
    maxQueriesPerRequirement: Math.max(
      1,
      Math.min(4, Number(raw.defaults?.max_queries_per_requirement || 2)),
    ),
  };
  return cachedRegistry;
}

export function resetEvidenceSourceRoutesForTests() {
  cachedRegistry = null;
}

function routeProfilesByUnit(structure: any, targetUnitIds: string[]) {
  const graph = loadDomainBusinessGraph();
  const target = new Set(targetUnitIds.map(String));
  const variableProfileIds = new Map<string, string[]>();
  for (const relation of graph?.relations || []) {
    if (relation.type !== "stateVariableUsesEvidenceProfile") continue;
    const values = variableProfileIds.get(String(relation.sourceId)) || [];
    values.push(String(relation.targetId));
    variableProfileIds.set(String(relation.sourceId), [...new Set(values)]);
  }

  const structureVariables = new Map<string, string>(
    (Array.isArray(structure?.variables) ? structure.variables : [])
      .map((variable: any) => [String(variable?.id || ""), String(variable?.ontology_node_id || "")])
      .filter(([id]: [string, string]) => Boolean(id)),
  );
  const variableIdsByUnit = new Map<string, Set<string>>();
  for (const path of Array.isArray(structure?.paths) ? structure.paths : []) {
    for (const unitId of Array.isArray(path?.judgment_unit_ids) ? path.judgment_unit_ids.map(String) : []) {
      if (target.size && !target.has(unitId)) continue;
      const values = variableIdsByUnit.get(unitId) || new Set<string>();
      for (const variableId of Array.isArray(path?.variable_ids) ? path.variable_ids.map(String) : []) {
        values.add(variableId);
      }
      variableIdsByUnit.set(unitId, values);
    }
  }

  const result = new Map<string, string[]>();
  for (const unit of Array.isArray(structure?.judgment_units) ? structure.judgment_units : []) {
    const unitId = String(unit?.id || "");
    if (!unitId || (target.size && !target.has(unitId))) continue;
    const ontologyIds = new Set<string>(
      (Array.isArray(unit?.ontology_node_ids) ? unit.ontology_node_ids : []).map(String),
    );
    for (const variableId of variableIdsByUnit.get(unitId) || []) {
      const ontologyId = structureVariables.get(variableId);
      if (ontologyId) ontologyIds.add(ontologyId);
    }
    result.set(unitId, [
      ...new Set([...ontologyIds].flatMap((ontologyId) => variableProfileIds.get(ontologyId) || [])),
    ]);
  }
  return result;
}

function compactSubject(question: string, requirement: string): string {
  const text = `${question} ${requirement}`;
  const terms = [
    ...(/HBM/i.test(text) ? ["HBM"] : []),
    ...(/非\s*HBM|通用\s*DRAM|DRAM/i.test(text) ? ["DRAM"] : []),
    ...(/NAND|SSD|UFS/i.test(text) ? ["NAND SSD"] : []),
    ...(/半导体|芯片/i.test(text) ? ["semiconductor"] : []),
  ];
  return [...new Set(terms)].join(" ") || requirement.replace(/\s+/g, " ").slice(0, 80);
}

function requirementQueryTerms(requirement: string): string[] {
  const mappings: Array<[RegExp, string]> = [
    [/合约价|合同价|contract price/i, "contract price"],
    [/现货价|spot price/i, "spot price"],
    [/价格|报价|pricing/i, "pricing"],
    [/库存|inventory/i, "inventory"],
    [/订单|order/i, "orders"],
    [/出货|shipment/i, "shipments"],
    [/资本开支|capex/i, "capex"],
    [/产能|capacity/i, "capacity"],
    [/投片|晶圆|wafer/i, "wafer allocation"],
    [/利用率|utilization/i, "utilization"],
    [/良率|yield/i, "yield"],
    [/量产|mass production/i, "mass production"],
    [/认证|qualification/i, "qualification"],
    [/下修|转弱|slowdown/i, "demand slowdown"],
  ];
  return mappings.flatMap(([pattern, term]) => pattern.test(requirement) ? [term] : []);
}

function routeScore(
  route: EvidenceSourceRoute,
  requirement: EvidenceRequirementProjection,
  judgmentTypes: string[],
  profileIds: string[],
) {
  const text = requirement.requirement.toLowerCase();
  let score = 0;
  if (route.evidence_roles.includes(requirement.evidence_role)) score += 12;
  score += route.judgment_types.filter((type) => judgmentTypes.includes(type)).length * 5;
  score += route.evidence_profile_ids.filter((id) => profileIds.includes(id)).length * 18;
  score += route.match_terms.filter((term) => text.includes(term.toLowerCase())).length * 4;
  if (requirement.evidence_role === "counter" && route.id.includes("counter")) score += 20;
  return score;
}

function producerOrder(producers: EvidenceRouteProducer[], role: EvidenceRequirementProjection["evidence_role"]) {
  const rank = (producer: EvidenceRouteProducer) => {
    const tier = Number(producer.tier.slice(1)) || 8;
    const independentBonus = role === "counter" && producer.authority_type === "industry_provider" ? -8 : 0;
    return tier + independentBonus;
  };
  return [...producers].sort((left, right) => rank(left) - rank(right) || left.domain.localeCompare(right.domain));
}

export function compileEvidenceAcquisitionPlan(input: {
  question: string;
  structure?: any;
  requirements?: EvidenceRequirementProjection[];
  targetUnitIds?: string[];
  cutoffMs?: number;
  maxQueries?: number;
}): EvidenceAcquisitionPlan {
  const registry = loadEvidenceSourceRoutes();
  const target = new Set((input.targetUnitIds || []).map(String));
  const requirements = (input.requirements || []).filter((requirement) =>
    !target.size || requirement.judgment_unit_ids.some((id) => target.has(String(id))),
  );
  const units = (Array.isArray(input.structure?.judgment_units) ? input.structure.judgment_units : [])
    .filter((unit: any) => !target.size || target.has(String(unit?.id || "")));
  const typeByUnit = new Map<string, string>(
    units.map((unit: any): [string, string] => [
      String(unit?.id || ""),
      String(unit?.judgment_type || ""),
    ]),
  );
  const profilesByUnit = routeProfilesByUnit(input.structure, [...target]);
  const year = new Date(Number.isFinite(input.cutoffMs) ? input.cutoffMs! : Date.now()).getUTCFullYear();

  const tasks = requirements.map((requirement, index): EvidenceAcquisitionTask => {
    const judgmentTypes: string[] = [
      ...new Set(requirement.judgment_unit_ids
        .map((id) => typeByUnit.get(String(id)) || "")
        .filter((value): value is string => Boolean(value))),
    ];
    // Stage02 的显式语义桥是主合同；结构反推只兼容旧产物。
    const explicitProfileIds = strings(requirement.evidence_profile_refs);
    const profileIds: string[] = explicitProfileIds.length
      ? explicitProfileIds
      : [
        ...new Set(requirement.judgment_unit_ids.flatMap((id) => profilesByUnit.get(String(id)) || [])),
      ];
    const missingProfileIds = profileIds.filter((profileId) =>
      !registry.routes.some((route) => route.evidence_profile_ids.includes(profileId)),
    );
    const routeCandidates = profileIds.length
      ? registry.routes.filter((route) =>
        route.evidence_profile_ids.some((profileId) => profileIds.includes(profileId))
        || (requirement.evidence_role === "counter" && route.id.includes("counter")),
      )
      : registry.routes;
    const rankedCandidates = routeCandidates
      .map((route) => ({ route, score: routeScore(route, requirement, judgmentTypes, profileIds) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.route.id.localeCompare(right.route.id))
      .map((item) => item.route);
    // 每个显式 Profile 至少保留一条最佳路线；再补反证专线与最高分路线。
    // 查询总量仍由 maxQueries / max_queries_per_requirement 限制，不能靠截断路线
    // 静默丢掉某个 Profile 的来源合同。
    const selectedRoutes: EvidenceSourceRoute[] = [];
    const addRoute = (route: EvidenceSourceRoute | undefined) => {
      if (route && !selectedRoutes.some((item) => item.id === route.id)) selectedRoutes.push(route);
    };
    for (const profileId of profileIds) {
      addRoute(rankedCandidates.find((route) => route.evidence_profile_ids.includes(profileId)));
    }
    if (requirement.evidence_role === "counter") {
      addRoute(rankedCandidates.find((route) => route.id.includes("counter")));
    }
    for (const route of rankedCandidates) {
      if (selectedRoutes.length >= 2) break;
      addRoute(route);
    }
    const routeMissing = missingProfileIds.length > 0;
    const routes = routeMissing
      ? []
      : (selectedRoutes.length ? selectedRoutes : registry.routes.slice(0, 1));
    const producers = producerOrder(
      [...new Map(routes.flatMap((route) => route.producers).map((producer) => [producer.domain, producer])).values()],
      requirement.evidence_role,
    );
    const subject = compactSubject(input.question, requirement.requirement);
    const queryTerms = [
      ...new Set([
        ...requirementQueryTerms(requirement.requirement),
        ...routes.flatMap((route) => route.query_terms),
      ]),
    ].slice(0, 3);
    const queries = producers.slice(0, registry.maxQueriesPerRequirement).map((producer) =>
      [`site:${producer.domain}`, subject, ...queryTerms, String(year)].filter(Boolean).join(" ").slice(0, 240),
    );
    return {
      task_id: `ACQ-${String(index + 1).padStart(2, "0")}-${requirement.id}`,
      status: routeMissing ? "route_missing" : "ready",
      failure_detail: routeMissing
        ? `EvidenceProfile 缺少机器来源路由：${missingProfileIds.join(", ")}`
        : null,
      requirement_id: requirement.id,
      judgment_unit_ids: requirement.judgment_unit_ids.map(String),
      judgment_types: judgmentTypes,
      evidence_role: requirement.evidence_role,
      evidence_profile_ids: profileIds,
      evidence_recipe_ref: requirement.evidence_recipe_ref || null,
      route_ids: routes.map((route) => route.id),
      preferred_channels: [...new Set(routes.flatMap((route) => route.preferred_channels))],
      mcp_channels: [...new Set(routes.flatMap((route) => route.mcp_channels))],
      query_card_refs: [...new Set(routes.flatMap((route) => route.query_card_refs))],
      verification_mode: routes.some((route) => route.verification_mode === "structured_or_quote")
        ? "structured_or_quote"
        : "quote_snapshot",
      allowed_producers: producers,
      queries,
    };
  });

  const maxQueries = Math.max(1, Math.min(12, Math.floor(input.maxQueries || 4)));
  return {
    registry_version: registry.version,
    generated_from: {
      requirement_ids: requirements.map((requirement) => requirement.id),
      judgment_unit_ids: [...new Set(requirements.flatMap((requirement) => requirement.judgment_unit_ids.map(String)))],
      evidence_profile_ids: [...new Set(tasks.flatMap((task) => task.evidence_profile_ids))],
    },
    tasks,
    gap_details: tasks.flatMap((task) => task.status === "route_missing"
      ? [{
        requirement_id: task.requirement_id,
        code: "route_missing" as const,
        detail: task.failure_detail || "EvidenceProfile 缺少机器来源路由",
        evidence_profile_ids: task.evidence_profile_ids,
      }]
      : []),
    queries: [...new Set(tasks.flatMap((task) => task.queries))].slice(0, maxQueries),
    allowed_producers: [
      ...new Map(tasks.flatMap((task) => task.allowed_producers).map((producer) => [producer.domain, producer])).values(),
    ],
  };
}

export function governedProducerForUrl(
  url: string,
  plan?: EvidenceAcquisitionPlan,
): EvidenceRouteProducer | undefined {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return plan?.allowed_producers.find((producer) =>
    host === producer.domain || host.endsWith(`.${producer.domain}`),
  );
}
