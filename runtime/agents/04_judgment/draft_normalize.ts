/**
 * Stage04 模型近失修：非正式 rule_ref、无证据却 executed 的 MA、空数组/null 占位。
 * 不捏造事实或方向结论；无法合法 executed 时降为 blocked/degraded，留给 J0 路径。
 */

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../../storage/repo_paths";
import { normalizeMethodApplicationNulls } from "../../skills/evidence_evaluation/draft_normalize";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

let cachedFormalRules: Set<string> | null = null;

export function formalOntologyRuleIds(): Set<string> {
  if (cachedFormalRules) return cachedFormalRules;
  const authority = YAML.parse(
    readFileSync(repositoryPath("governance/02_合同/rule_authority_registry.yaml"), "utf8"),
  ) as { formal_ontology_rules?: Record<string, unknown> };
  cachedFormalRules = new Set(Object.keys(authority.formal_ontology_rules || {}));
  return cachedFormalRules;
}

function normalizeAlternatives(value: unknown, methodId: string): Array<{ method_id: string; decision: string; reason: string }> {
  const raw = Array.isArray(value) ? value : [];
  const out: Array<{ method_id: string; decision: string; reason: string }> = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({
        method_id: methodId || "unknown",
        decision: "use_alternative_or_j0",
        reason: item.trim(),
      });
      continue;
    }
    if (!isPlainObject(item)) continue;
    out.push({
      method_id: nonEmpty(item.method_id) ? String(item.method_id) : (methodId || "unknown"),
      decision: nonEmpty(item.decision) ? String(item.decision) : "use_alternative_or_j0",
      reason: nonEmpty(item.reason) ? String(item.reason) : "模型未给出替代理由",
    });
  }
  return out;
}

function demoteExecutedWithoutEvidence(application: Record<string, unknown>): Record<string, unknown> {
  const methodId = String(application.method_id || "unknown");
  let alternatives = normalizeAlternatives(application.alternatives, methodId);
  const refs = Array.isArray(application.input_evidence_refs) ? application.input_evidence_refs : [];
  const status = String(application.status || "");
  const provenance: Record<string, unknown> = isPlainObject(application.provenance) ? { ...application.provenance } : {
    stage: "stage_04",
    source_application_id: application.application_id || null,
    actor: "model",
    recorded_at: null,
  };
  provenance.stage = "stage_04";
  if (!nonEmpty(provenance.actor)) provenance.actor = "model";
  if (provenance.source_application_id === undefined) {
    provenance.source_application_id = application.application_id || null;
  }

  if (status === "executed") {
    const checks = Array.isArray(application.precondition_checks) ? [...application.precondition_checks] : [];
    const nonPassing = checks.filter((check) => {
      if (!isPlainObject(check)) return true;
      return check.result !== "pass";
    });
    if (!refs.length || nonPassing.length) {
      const limitations = Array.isArray(application.limitations) ? [...application.limitations.map(String)] : [];
      if (!refs.length && !limitations.some((item) => item.includes("输入证据"))) {
        limitations.push("缺少可绑定的非 gap 输入证据，不能确认 executed");
      }
      if (nonPassing.length && !limitations.some((item) => item.includes("前置条件"))) {
        limitations.push(`executed 含未通过前置条件: ${nonPassing.map((check) => isPlainObject(check) ? String(check.precondition_id || "unknown") : "invalid").join(", ")}`);
      }
      if (!alternatives.length) {
        alternatives = [{
          method_id: methodId,
          decision: "keep_j0_until_evidence",
          reason: "保持 J0/indeterminate，待补齐可核验事实或满足前置条件后重跑裁决",
        }];
      }
      const hasFailure = checks.some((check) => {
        if (!isPlainObject(check)) return false;
        return check.result === "fail" || check.result === "partial";
      });
      if (!hasFailure) {
        checks.push({
          precondition_id: refs.length ? "precondition_unmet" : "evidence_binding",
          result: "fail",
          evidence_refs: [],
          reason: refs.length
            ? "模型将方法标为 executed 但前置条件未全部 pass；Runtime 降为 blocked"
            : "模型将方法标为 executed 但未绑定输入证据；Runtime 降为 blocked",
        });
      }
      provenance.recorded_at = null;
      return {
        ...application,
        status: "blocked",
        precondition_checks: checks,
        input_evidence_refs: refs.length ? refs : [],
        output_signal_refs: [],
        output_judgment_refs: [],
        limitations,
        alternatives,
        provenance,
        execution_summary: nonEmpty(application.execution_summary)
          ? String(application.execution_summary)
          : "因缺少输入证据或前置条件未通过，未确认 executed",
      };
    }
    if (!nonEmpty(provenance.recorded_at)) {
      provenance.recorded_at = new Date().toISOString();
    }
  }

  if (["blocked", "rejected", "degraded"].includes(status) && !alternatives.length) {
    alternatives = [{
      method_id: methodId,
      decision: "keep_j0_until_evidence",
      reason: "方法未完成执行，保持暂不可判断并等待补证",
    }];
  }

  return {
    ...application,
    alternatives,
    provenance,
  };
}

function repairRuleEvaluations(items: unknown[]): unknown[] {
  const formal = formalOntologyRuleIds();
  const fallback = formal.has("judgment_status_consistency")
    ? "judgment_status_consistency"
    : [...formal][0] || "judgment_status_consistency";
  return items.map((item, index) => {
    if (!isPlainObject(item)) return item;
    const next = { ...item };
    if (!nonEmpty(next.id)) next.id = `RE-REPAIR-${String(index + 1).padStart(2, "0")}`;
    const ruleRef = String(next.rule_ref || "");
    if (!formal.has(ruleRef)) next.rule_ref = fallback;
    if (!Array.isArray(next.input_refs)) next.input_refs = [];
    if (!Array.isArray(next.condition_results) || !next.condition_results.length) {
      const refs = (next.input_refs as unknown[]).map(String).filter(Boolean);
      next.condition_results = [{
        condition_id: "repaired_condition",
        expression: "runtime repaired informal or empty rule evaluation",
        input_refs: refs.length ? refs : [String(next.id)],
        outcome: "pass",
        rationale: "Runtime 将非正式/空规则评估改写为正式本体规则占位，最终结果由确定性规则覆盖",
      }];
      if (!refs.length) next.input_refs = [String(next.id)];
    } else {
      next.condition_results = (next.condition_results as unknown[]).map((condition) => {
        if (!isPlainObject(condition)) return condition;
        const input_refs = Array.isArray(condition.input_refs)
          ? condition.input_refs.map(String).filter(Boolean)
          : [];
        return {
          ...condition,
          condition_id: nonEmpty(condition.condition_id) ? String(condition.condition_id) : "condition",
          input_refs: input_refs.length ? input_refs : (next.input_refs as string[]),
        };
      });
    }
    const declared = new Set((next.input_refs as unknown[]).map(String).filter(Boolean));
    for (const condition of next.condition_results as unknown[]) {
      if (!isPlainObject(condition) || !Array.isArray(condition.input_refs)) continue;
      for (const ref of condition.input_refs) declared.add(String(ref));
    }
    next.input_refs = [...declared];
    return next;
  });
}

function repairJudgmentStopPath(judgment: Record<string, unknown>, applications: Record<string, unknown>[]): Record<string, unknown> {
  const byId = new Map(applications.map((item) => [String(item.application_id || ""), item]));
  const bound = (Array.isArray(judgment.method_application_ids) ? judgment.method_application_ids : [])
    .map((id) => byId.get(String(id)))
    .filter(Boolean) as Record<string, unknown>[];
  const adjudication = bound.filter((item) => item.capability_type === "adjudication");
  const hasExecutedAdjudication = adjudication.some((item) => item.status === "executed");
  const supporting = Array.isArray(judgment.supporting_evidence_draft_ids) ? judgment.supporting_evidence_draft_ids : [];
  const counter = Array.isArray(judgment.counter_evidence_draft_ids) ? judgment.counter_evidence_draft_ids : [];
  if (hasExecutedAdjudication && (supporting.length || counter.length)) return judgment;

  return {
    ...judgment,
    strength: "J0",
    confidence: nonEmpty(judgment.confidence) ? judgment.confidence : "low",
    decision_status: ["blocked", "indeterminate", "contested"].includes(String(judgment.decision_status || ""))
      ? judgment.decision_status
      : "indeterminate",
    conflict_status: nonEmpty(judgment.conflict_status) ? judgment.conflict_status : "none",
    not_judgeable_reason: nonEmpty(judgment.not_judgeable_reason)
      ? judgment.not_judgeable_reason
      : "缺少 executed adjudication 或事实级证据，保持暂不可判断",
    supporting_evidence_draft_ids: supporting,
    counter_evidence_draft_ids: counter,
  };
}

export type RepairJudgmentContext = {
  judgmentUnitIds?: string[];
  scopeRef?: string | null;
};

export function repairJudgmentPreparationDraft(data: unknown, context: RepairJudgmentContext = {}): unknown {
  if (!isPlainObject(data)) return data;
  const next: Record<string, unknown> = { ...data };
  const unitIds = (context.judgmentUnitIds || []).map(String).filter(Boolean);
  const scopeRef = String(context.scopeRef || unitIds[0] || "SCOPE-UNKNOWN");

  const applications = (Array.isArray(next.method_applications) ? next.method_applications : [])
    .map((item) => normalizeMethodApplicationNulls(item))
    .map((item) => (isPlainObject(item) ? demoteExecutedWithoutEvidence(item) : item));
  // Ensure every MA targets at least one known unit when available.
  next.method_applications = applications.map((item) => {
    if (!isPlainObject(item) || !unitIds.length) return item;
    const refs = Array.isArray(item.target_judgment_unit_refs)
      ? item.target_judgment_unit_refs.map(String).filter((id) => unitIds.includes(id))
      : [];
    return {
      ...item,
      target_judgment_unit_refs: refs.length ? refs : [unitIds[0]],
    };
  });

  if (Array.isArray(next.rule_evaluations)) {
    next.rule_evaluations = repairRuleEvaluations(next.rule_evaluations);
  } else {
    next.rule_evaluations = [];
  }

  if (Array.isArray(next.signals)) {
    next.signals = next.signals.map((item) => {
      if (!isPlainObject(item)) return item;
      return {
        ...item,
        evidence_draft_ids: Array.isArray(item.evidence_draft_ids) ? item.evidence_draft_ids : [],
        target_hypothesis_ids: Array.isArray(item.target_hypothesis_ids) ? item.target_hypothesis_ids : [],
        judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids : [],
      };
    });
  } else {
    next.signals = [];
  }

  const appRecords = (next.method_applications as unknown[]).filter(isPlainObject) as Record<string, unknown>[];
  let hypotheses = Array.isArray(next.hypotheses)
    ? next.hypotheses.map((item) => {
      if (!isPlainObject(item)) return item;
      return {
        ...item,
        signal_ids: Array.isArray(item.signal_ids) ? item.signal_ids : [],
        falsification_conditions: Array.isArray(item.falsification_conditions) && item.falsification_conditions.length
          ? item.falsification_conditions
          : ["取得与当前命题方向相反且同口径的可核验事实"],
        judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids : [],
      };
    })
    : [];

  if (Array.isArray(next.judgments)) {
    next.judgments = next.judgments.map((item, index) => {
      if (!isPlainObject(item)) return item;
      let unitId = String(item.judgment_unit_id || "");
      if (unitIds.length && !unitIds.includes(unitId)) {
        const matched = unitIds.find((id) => String(item.id || "").includes(id) || id.includes(unitId));
        unitId = matched || unitIds[Math.min(index, unitIds.length - 1)];
      }
      let hypothesisIds = Array.isArray(item.hypothesis_ids) ? item.hypothesis_ids.map(String) : [];
      hypothesisIds = hypothesisIds.filter((id) => hypotheses.some((hypothesis) => isPlainObject(hypothesis) && String(hypothesis.id) === id));
      if (!hypothesisIds.length) {
        const hypothesisId = `H-REPAIR-${String(item.id || index + 1)}`;
        hypotheses = [...hypotheses, {
          id: hypothesisId,
          statement: `${unitId || "判断单元"} 的方向命题目前未被可核验事实充分检验`,
          signal_ids: [],
          falsification_conditions: ["取得同口径可核验反证或补齐关键证据"],
          time_horizon: "补齐证据后重新裁决",
          judgment_unit_ids: unitId ? [unitId] : [],
        }];
        hypothesisIds = [hypothesisId];
      }
      let methodIds = Array.isArray(item.method_application_ids) ? item.method_application_ids.map(String) : [];
      const boundApps = methodIds.map((id) => appRecords.find((app) => String(app.application_id) === id)).filter(Boolean) as Record<string, unknown>[];
      const hasAdjudication = boundApps.some((app) => app.capability_type === "adjudication");
      if (!hasAdjudication) {
        const adjudication = appRecords.find((app) =>
          app.capability_type === "adjudication"
          && Array.isArray(app.target_judgment_unit_refs)
          && app.target_judgment_unit_refs.map(String).includes(unitId));
        if (adjudication?.application_id) methodIds = [...new Set([...methodIds, String(adjudication.application_id)])];
      }
      const repaired = repairJudgmentStopPath({
        ...item,
        judgment_unit_id: unitId || item.judgment_unit_id,
        scope_ref: nonEmpty(item.scope_ref) ? item.scope_ref : scopeRef,
        supporting_evidence_draft_ids: Array.isArray(item.supporting_evidence_draft_ids) ? item.supporting_evidence_draft_ids : [],
        counter_evidence_draft_ids: Array.isArray(item.counter_evidence_draft_ids) ? item.counter_evidence_draft_ids : [],
        hypothesis_ids: hypothesisIds,
        rule_evaluation_ids: Array.isArray(item.rule_evaluation_ids) ? item.rule_evaluation_ids : [],
        method_application_ids: methodIds,
        conditions: Array.isArray(item.conditions) ? item.conditions : [],
        uncertainties: Array.isArray(item.uncertainties) ? item.uncertainties : [],
        invalidation_conditions: Array.isArray(item.invalidation_conditions) ? item.invalidation_conditions : [],
        tracking_signals: Array.isArray(item.tracking_signals) ? item.tracking_signals : [],
        ontology_node_ids: Array.isArray(item.ontology_node_ids) ? item.ontology_node_ids : [],
      }, appRecords);
      return repaired;
    });
  } else {
    next.judgments = [];
  }
  next.hypotheses = hypotheses;

  if (Array.isArray(next.competing_explanations)) {
    next.competing_explanations = next.competing_explanations.map((item) => {
      if (!isPlainObject(item)) return item;
      return {
        ...item,
        signal_ids: Array.isArray(item.signal_ids) ? item.signal_ids : [],
        discriminating_evidence: Array.isArray(item.discriminating_evidence) && item.discriminating_evidence.length
          ? item.discriminating_evidence
          : ["取得可区分主路径与竞争解释的同口径事实"],
        judgment_unit_ids: Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids : [],
      };
    });
  } else {
    next.competing_explanations = [];
  }

  if (!Array.isArray(next.reasoning_traces)) {
    next.reasoning_traces = [];
  }
  {
    const now = new Date().toISOString();
    const existing = new Map<string, Record<string, unknown>>();
    for (const item of next.reasoning_traces as unknown[]) {
      if (!isPlainObject(item)) continue;
      const judgmentId = String(item.judgment_id || "");
      if (judgmentId) existing.set(judgmentId, item);
    }
    const rebuilt: Record<string, unknown>[] = [];
    const judgments = Array.isArray(next.judgments) ? next.judgments : [];
    const hypotheses = new Map(
      (Array.isArray(next.hypotheses) ? next.hypotheses : [])
        .filter(isPlainObject)
        .map((item) => [String(item.id || ""), item]),
    );
    for (const [index, judgment] of judgments.entries()) {
      if (!isPlainObject(judgment)) continue;
      const judgmentId = String(judgment.id || "");
      if (!judgmentId) continue;
      const prior = existing.get(judgmentId) || {};
      const nodeIds = new Set<string>([
        judgmentId,
        ...((Array.isArray(judgment.supporting_evidence_draft_ids) ? judgment.supporting_evidence_draft_ids : []).map(String)),
        ...((Array.isArray(judgment.counter_evidence_draft_ids) ? judgment.counter_evidence_draft_ids : []).map(String)),
        ...((Array.isArray(judgment.hypothesis_ids) ? judgment.hypothesis_ids : []).map(String)),
        ...((Array.isArray(judgment.rule_evaluation_ids) ? judgment.rule_evaluation_ids : []).map(String)),
        ...((Array.isArray(judgment.method_application_ids) ? judgment.method_application_ids : []).map(String)),
      ]);
      for (const hypothesisId of Array.isArray(judgment.hypothesis_ids) ? judgment.hypothesis_ids : []) {
        const hypothesis = hypotheses.get(String(hypothesisId));
        for (const signalId of Array.isArray(hypothesis?.signal_ids) ? hypothesis!.signal_ids : []) {
          nodeIds.add(String(signalId));
        }
      }
      rebuilt.push({
        ...prior,
        id: nonEmpty(prior.id) ? prior.id : `RT-REPAIR-${String(index + 1).padStart(2, "0")}`,
        judgment_id: judgmentId,
        node_ids: [...nodeIds],
        created_at: nonEmpty(prior.created_at) ? prior.created_at : now,
      });
    }
    next.reasoning_traces = rebuilt;
  }
  if (!nonEmpty(next.overall_boundary)) {
    next.overall_boundary = "证据不足或方法未完成执行时保持暂不可判断，不外推投资建议。";
  }
  if (!nonEmpty(next.document_markdown)) {
    next.document_markdown = "# 判断裁决\n\nRuntime 已对近失结构化结果做契约修复；请人工审阅后确认。";
  }

  return next;
}
