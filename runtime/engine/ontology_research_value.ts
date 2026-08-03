import type { BusinessInstanceGraph } from "./instance_graph";

export type OntologyResearchEffectKind = "completion" | "constraint" | "connection";

export type OntologyResearchEffect = {
  id: string;
  kind: OntologyResearchEffectKind;
  status: "applied" | "checked" | "candidate" | "registered";
  observed_contribution: boolean;
  title: string;
  explanation: string;
  result: string;
  object_refs: string[];
  ontology_refs: string[];
};

export type OntologyResearchValueSummary = {
  effects: OntologyResearchEffect[];
  counts: Record<OntologyResearchEffectKind, number>;
  relevant_node_ids: string[];
};

type StructureVariable = {
  id?: string;
  name?: string;
  ontology_node_id?: string;
};

type JudgmentUnit = {
  id?: string;
  judgment_unit_id?: string;
  title?: string;
  statement?: string;
  ontology_node_ids?: string[];
};

type RuleEvaluation = {
  id?: string;
  rule_evaluation_id?: string;
  rule_ref?: string;
  result?: string;
  deterministic_result?: { result?: string; rationale?: string } | null;
  condition_results?: Array<{ outcome?: string; rationale?: string }>;
};

const RESEARCH_PROCESS_TYPES = new Set([
  "ResearchQuestion", "JudgmentUnit", "EvidenceRequirement", "SourceDocument", "EvidenceClaim",
  "EvidenceFact", "EvidenceAssessment", "EvidenceBasket", "Signal", "Hypothesis",
  "CompetingExplanation", "BlockingFactor", "RuleEvaluation", "Judgment", "ReasoningTrace",
  "MethodApplication", "ResearchPath", "ActionProposal", "ActionExecution",
]);

function strings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))] : [];
}

function uniqueEffects(effects: OntologyResearchEffect[]): OntologyResearchEffect[] {
  return [...new Map(effects.map((effect) => [effect.id, effect])).values()];
}

function outcomeLabel(outcome: string): string {
  return {
    pass: "通过",
    fail: "未通过",
    blocked: "阻断",
    contested: "存在争议",
  }[outcome] || outcome || "未记录";
}

/**
 * 把本体对单次研究的真实作用投影成研究员语言。这里只解释产物中已经存在的
 * 绑定、确定性规则结果和实例图关系，不把“目录里存在”误写成“本轮已生效”。
 */
export function deriveOntologyResearchValue(input: {
  structure?: {
    variables?: StructureVariable[];
    judgment_units?: JudgmentUnit[];
  };
  judgment?: {
    rule_evaluations?: RuleEvaluation[];
  };
  graph?: BusinessInstanceGraph;
  labelForOntologyRef?: (ref: string) => string;
}): OntologyResearchValueSummary {
  const labelFor = input.labelForOntologyRef || ((ref: string) => ref);
  const variables = input.structure?.variables || [];
  const variableByRef = new Map<string, StructureVariable>();
  const effects: OntologyResearchEffect[] = [];
  const relevant = new Set<string>();

  for (const variable of variables) {
    const id = String(variable.id || "").trim();
    const name = String(variable.name || id || "未命名变量").trim();
    const ontologyRef = String(variable.ontology_node_id || "").trim();
    if (id) variableByRef.set(id, variable);
    if (ontologyRef) variableByRef.set(ontologyRef, variable);
    if (!ontologyRef) continue;

    if (ontologyRef.startsWith("task_local:")) {
      effects.push({
        id: `constraint:task-local:${id || ontologyRef}`,
        kind: "constraint",
        status: "candidate",
        observed_contribution: false,
        title: `保留“${name}”为本轮候选`,
        explanation: "正式变量库没有被强行套用；该概念只在本研究内生效，等待复用证据和专家确认后再决定是否晋升。",
        result: "限制：避免错误口径进入跨任务推理",
        object_refs: id ? [id] : [],
        ontology_refs: [ontologyRef],
      });
      continue;
    }

    relevant.add(ontologyRef);
    effects.push({
      id: `completion:binding:${id || ontologyRef}`,
      kind: "completion",
      status: "registered",
      observed_contribution: false,
      title: `对齐“${name}”的正式口径`,
      explanation: `本轮变量绑定到正式 StateVariable“${labelFor(ontologyRef)}”，获得稳定身份；时间、范围和单位仍需分别核验。`,
      result: "补全：支持同口径跨 run 对齐与复用",
      object_refs: id ? [id] : [],
      ontology_refs: [ontologyRef],
    });
  }

  for (const unit of input.structure?.judgment_units || []) {
    const id = String(unit.id || unit.judgment_unit_id || "").trim();
    const title = String(unit.title || unit.statement || id || "未命名判断").trim();
    const refs = strings(unit.ontology_node_ids).filter((ref) => !ref.startsWith("task_local:"));
    refs.forEach((ref) => relevant.add(ref));
    if (!refs.length) continue;
    const labels = refs.map((ref) => variableByRef.get(ref)?.name || labelFor(ref));
    effects.push({
      id: `connection:unit:${id || refs.join("|")}`,
      kind: "connection",
      status: "registered",
      observed_contribution: false,
      title: `“${title}”连接到 ${labels.join("、")}`,
      explanation: "判断单元与标准变量显式绑定，因此变量口径变化、证据更新和后续判断可以沿关系定位影响范围。",
      result: "关联：形成可追溯的变量—判断路径",
      object_refs: id ? [id, ...refs] : refs,
      ontology_refs: refs,
    });
  }

  for (const evaluation of input.judgment?.rule_evaluations || []) {
    const id = String(evaluation.id || evaluation.rule_evaluation_id || "").trim();
    const ruleRef = String(evaluation.rule_ref || "").trim();
    if (!ruleRef) continue;
    relevant.add(ruleRef);
    const outcome = String(evaluation.deterministic_result?.result || evaluation.result || "").trim();
    const applied = ["fail", "blocked", "contested"].includes(outcome);
    const rationale = String(
      evaluation.deterministic_result?.rationale
        || evaluation.condition_results?.find((item) => item.outcome && item.outcome !== "pass")?.rationale
        || evaluation.condition_results?.at(-1)?.rationale
        || "已按正式规则检查当前输入",
    ).trim();
    effects.push({
      id: `constraint:rule:${id || ruleRef}`,
      kind: "constraint",
      status: applied ? "applied" : "checked",
      observed_contribution: applied,
      title: `${labelFor(ruleRef)}：${outcomeLabel(outcome)}`,
      explanation: rationale,
      result: applied
        ? "限制：阻止判断越过当前证据与语义边界"
        : "核验：已检查该规则边界，未观察到其改变本轮结论",
      object_refs: id ? [id] : [],
      ontology_refs: [ruleRef],
    });
  }

  const graph = input.graph;
  if (graph) {
    const objectById = new Map(graph.objects.map((object) => [object.id, object]));
    const businessObjectsByType = new Map<string, typeof graph.objects>();
    for (const object of graph.objects) relevant.add(object.type);
    for (const object of graph.objects) {
      if (RESEARCH_PROCESS_TYPES.has(object.type)) continue;
      const group = businessObjectsByType.get(object.type) || [];
      group.push(object);
      businessObjectsByType.set(object.type, group);
    }
    for (const [type, objects] of businessObjectsByType) {
      const examples = objects.slice(0, 3).map((object) => String(
        object.properties?.name || object.properties?.title || object.properties?.label || object.id,
      ));
      effects.push({
        id: `completion:object-type:${type}`,
        kind: "completion",
        status: "registered",
        observed_contribution: false,
        title: `识别 ${objects.length} 个“${labelFor(type)}”对象`,
        explanation: `实例图把 ${examples.join("、")}${objects.length > 3 ? "等" : ""} 归入统一对象类型，供范围、关系和跨 run 查询使用。`,
        result: "补全：为业务对象提供可查询的标准类型",
        object_refs: objects.map((object) => object.id),
        ontology_refs: [type],
      });
    }
    for (const relation of graph.relations) {
      relevant.add(relation.type);
      const source = objectById.get(relation.sourceId);
      const target = objectById.get(relation.targetId);
      if (!source || !target) continue;
      const sourceLabel = String(source.properties?.name || source.properties?.title || source.properties?.statement || source.id);
      const targetLabel = String(target.properties?.name || target.properties?.title || target.properties?.statement || target.id);
      effects.push({
        id: `connection:relation:${relation.id}`,
        kind: "connection",
        status: "registered",
        observed_contribution: false,
        title: `${sourceLabel} → ${targetLabel}`,
        explanation: `实例图通过“${labelFor(relation.type)}”记录这条关系；任一端变化时可据此查询相邻对象与下游影响。`,
        result: "关联：支持影响查询与局部重算",
        object_refs: [relation.sourceId, relation.targetId],
        ontology_refs: [source.type, relation.type, target.type],
      });
    }
  }

  const unique = uniqueEffects(effects);
  return {
    effects: unique,
    counts: {
      completion: unique.filter((effect) => effect.kind === "completion").length,
      constraint: unique.filter((effect) => effect.kind === "constraint").length,
      connection: unique.filter((effect) => effect.kind === "connection").length,
    },
    relevant_node_ids: [...relevant],
  };
}
