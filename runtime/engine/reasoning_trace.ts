import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { MethodApplication } from "./types";

type ReasoningData = {
  signals: Array<{ id: string; evidence_draft_ids: string[]; target_hypothesis_ids: string[] }>;
  hypotheses: Array<{ id: string; signal_ids: string[]; falsification_conditions: string[] }>;
  rule_evaluations: Array<{
    id: string;
    rule_ref: string;
    input_refs: string[];
    condition_results: Array<{ condition_id: string; input_refs: string[] }>;
  }>;
  judgments: Array<{
    id: string;
    supporting_evidence_draft_ids: string[];
    counter_evidence_draft_ids: string[];
    hypothesis_ids: string[];
    rule_evaluation_ids: string[];
    method_application_ids: string[];
  }>;
  reasoning_traces: Array<{ id: string; judgment_id: string; node_ids: string[] }>;
};

function uniqueIndex<T extends { id: string }>(items: T[], label: string) {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`${label} ID 重复: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

export function validateReasoningTraceBindings(
  data: ReasoningData,
  evidenceIds: Set<string>,
  applications: MethodApplication[],
) {
  const signals = uniqueIndex(data.signals || [], "Signal");
  const hypotheses = uniqueIndex(data.hypotheses || [], "Hypothesis");
  const evaluations = uniqueIndex(data.rule_evaluations || [], "RuleEvaluation");
  const judgments = uniqueIndex(data.judgments || [], "Judgment");
  const executed = new Set(applications.filter((item) => item.status === "executed").map((item) => item.application_id));
  const authority = YAML.parse(readFileSync(repositoryPath("governance/02_合同/rule_authority_registry.yaml"), "utf8"));
  const formalRules = new Set(Object.keys(authority.formal_ontology_rules || {}));

  for (const signal of signals.values()) {
    if (!signal.evidence_draft_ids.length) throw new Error(`${signal.id} 必须绑定具体 EvidenceFact`);
    for (const ref of signal.evidence_draft_ids) {
      if (!evidenceIds.has(ref)) throw new Error(`${signal.id} 引用了不存在的证据 ${ref}`);
    }
    for (const ref of signal.target_hypothesis_ids) {
      if (!hypotheses.has(ref)) throw new Error(`${signal.id} 引用了不存在的假设 ${ref}`);
    }
  }
  for (const hypothesis of hypotheses.values()) {
    if (!hypothesis.falsification_conditions.length) throw new Error(`${hypothesis.id} 缺少证伪条件`);
    for (const ref of hypothesis.signal_ids) {
      const signal = signals.get(ref);
      if (!signal) throw new Error(`${hypothesis.id} 引用了不存在的信号 ${ref}`);
      if (!signal.target_hypothesis_ids.includes(hypothesis.id)) {
        throw new Error(`${hypothesis.id}/${ref} 的信号假设关系不是双向的`);
      }
    }
  }
  for (const evaluation of evaluations.values()) {
    if (!formalRules.has(evaluation.rule_ref)) {
      throw new Error(`${evaluation.id} 不能用非正式本体规则支撑判断: ${evaluation.rule_ref}`);
    }
    const inputs = new Set(evaluation.input_refs);
    if (!evaluation.condition_results.length) throw new Error(`${evaluation.id} 缺少逐项条件结果`);
    for (const condition of evaluation.condition_results) {
      if (!condition.input_refs.length) throw new Error(`${evaluation.id}.${condition.condition_id} 缺少具体输入`);
      for (const ref of condition.input_refs) {
        if (!inputs.has(ref)) throw new Error(`${evaluation.id}.${condition.condition_id} 使用了未声明输入 ${ref}`);
      }
      if (condition.input_refs.every((ref) => ref.startsWith("EB-"))) {
        throw new Error(`${evaluation.id}.${condition.condition_id} 不得只引用 EvidenceBasket`);
      }
    }
  }
  for (const judgment of judgments.values()) {
    const evidence = [...judgment.supporting_evidence_draft_ids, ...judgment.counter_evidence_draft_ids];
    if (!evidence.length) throw new Error(`${judgment.id} 缺少具体 EvidenceFact`);
    const linkedSignals = [...signals.values()].filter((signal) => signal.target_hypothesis_ids.some((id) => judgment.hypothesis_ids.includes(id)));
    const signalEvidence = new Set(linkedSignals.flatMap((signal) => signal.evidence_draft_ids));
    for (const ref of evidence) {
      if (!signalEvidence.has(ref)) throw new Error(`${judgment.id} 的证据 ${ref} 绕过了 Signal/Hypothesis`);
    }
    for (const ref of judgment.hypothesis_ids) if (!hypotheses.has(ref)) throw new Error(`${judgment.id} 引用了不存在的假设 ${ref}`);
    for (const ref of judgment.rule_evaluation_ids) if (!evaluations.has(ref)) throw new Error(`${judgment.id} 引用了不存在的规则评估 ${ref}`);
    if (!judgment.method_application_ids.some((ref) => executed.has(ref))) {
      throw new Error(`${judgment.id} 缺少 executed MethodApplication`);
    }
  }
  const tracesByJudgment = new Map<string, Array<{ id: string; node_ids: string[] }>>();
  for (const trace of data.reasoning_traces || []) {
    tracesByJudgment.set(trace.judgment_id, [...(tracesByJudgment.get(trace.judgment_id) || []), trace]);
  }
  for (const judgment of judgments.values()) {
    const required = new Set([
      judgment.id,
      ...judgment.supporting_evidence_draft_ids,
      ...judgment.counter_evidence_draft_ids,
      ...judgment.hypothesis_ids,
      ...judgment.rule_evaluation_ids,
      ...judgment.method_application_ids,
    ]);
    for (const hypothesisId of judgment.hypothesis_ids) {
      for (const signalId of hypotheses.get(hypothesisId)?.signal_ids || []) required.add(signalId);
    }
    const traces = tracesByJudgment.get(judgment.id) || [];
    if (!traces.some((trace) => [...required].every((ref) => trace.node_ids.includes(ref)))) {
      throw new Error(`${judgment.id} 缺少完整 ReasoningTrace`);
    }
  }
}
