"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import {
  judgmentDecisionStatusLabel,
  judgmentStrengthLabel,
  researcherLanguage,
  researcherMarkdown,
} from "@/app/lib/researcher-stage-output";
import type { EvidenceOption, MethodApplicationOption, UnitOption } from "./types";
import { lines } from "./helpers";

type JudgmentUnitSeed = {
  conclusion: string;
  rationale: string;
  conditions: string;
  trackingSignals: string;
  evidenceRoles: Record<string, "none" | "support" | "counter">;
  uncertainties: string;
  invalidations: string;
  competition: string;
  sourceExplanationId: string;
  discriminators: string;
  resolution: string;
  confirmedPreconditions: string[];
  strength?: string;
  decisionStatus?: string;
};

function parseJudgmentJson(
  existingJson: string | undefined,
  units: UnitOption[],
  evidence: EvidenceOption[],
  methodApplications: MethodApplicationOption[],
  structureCompetingExplanations: Array<{ explanation_id: string; statement: string; judgment_unit_ids: string[] }>,
): Record<string, JudgmentUnitSeed> {
  let existing: any = {};
  try { existing = JSON.parse(existingJson || "{}"); } catch { existing = {}; }
  const automaticallyConfirmed = new Set(["judgment_unit", "object_scope", "controlled_source_verification"]);
  const seed: Record<string, JudgmentUnitSeed> = {};
  for (const unit of units) {
    const judgment = (existing.judgments || []).find((item: any) => String(item.judgment_unit_id) === unit.id);
    const primaryCompetition = (existing.competing_explanations || []).find((item: any) =>
      (item.judgment_unit_ids || []).includes(unit.id) && !String(item.id || "").includes("-S"));
    const structureCandidate = structureCompetingExplanations.find((item) =>
      item.judgment_unit_ids.length === 0 || item.judgment_unit_ids.includes(unit.id));
    const elimination = String(primaryCompetition?.elimination_rationale || "");
    const resolution = elimination.startsWith("研究者记录的有限裁决：")
      ? elimination.replace(/^研究者记录的有限裁决：/, "").replace(/；竞争解释仍不得标记为 eliminated$/, "").trim()
      : "";
    const evidenceRoles: Record<string, "none" | "support" | "counter"> = {};
    for (const item of evidence.filter((row) => row.judgment_unit_ids.includes(unit.id))) {
      if ((judgment?.supporting_evidence_draft_ids || []).includes(item.id)) evidenceRoles[item.id] = "support";
      else if ((judgment?.counter_evidence_draft_ids || []).includes(item.id)) evidenceRoles[item.id] = "counter";
      else evidenceRoles[item.id] = "none";
    }
    const confirmedFromMa = methodApplications
      .filter((application) => application.target_judgment_unit_refs.includes(unit.id))
      .flatMap((application) => application.precondition_checks
        .filter((check) => !automaticallyConfirmed.has(check.precondition_id))
        .map((check) => check.precondition_id));
    seed[unit.id] = {
      conclusion: researcherLanguage(judgment?.conclusion),
      rationale: researcherMarkdown(judgment?.rationale),
      conditions: researcherMarkdown((judgment?.conditions || []).join("\n")),
      trackingSignals: researcherMarkdown((judgment?.tracking_signals || []).join("\n")),
      evidenceRoles,
      uncertainties: researcherMarkdown((judgment?.uncertainties || []).join("\n")),
      invalidations: researcherMarkdown((judgment?.invalidation_conditions || []).join("\n")),
      competition: researcherLanguage(primaryCompetition?.statement || structureCandidate?.statement),
      sourceExplanationId: String(primaryCompetition?.source_explanation_id || structureCandidate?.explanation_id || ""),
      discriminators: researcherMarkdown((primaryCompetition?.discriminating_evidence || []).join("\n")),
      resolution: researcherMarkdown(resolution),
      confirmedPreconditions: confirmedFromMa,
      strength: judgment?.strength ? String(judgment.strength) : undefined,
      decisionStatus: judgment?.decision_status ? String(judgment.decision_status) : undefined,
    };
  }
  return seed;
}

export type ControlledJudgmentProjectionFormHandle = {
  save: () => Promise<boolean>;
};

export const ControlledJudgmentProjectionForm = forwardRef<ControlledJudgmentProjectionFormHandle, {
  runId: string;
  units: UnitOption[];
  evidence: EvidenceOption[];
  methodApplications: MethodApplicationOption[];
  structureCompetingExplanations?: Array<{ explanation_id: string; statement: string; judgment_unit_ids: string[] }>;
  existingJson?: string;
  enabled?: boolean;
  variant?: "workspace" | "fallback";
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: string) => void;
}>(function ControlledJudgmentProjectionForm({
  runId,
  units,
  evidence,
  methodApplications,
  structureCompetingExplanations = [],
  existingJson,
  enabled = true,
  variant = "workspace",
  onBusyChange,
  onError,
}, ref) {
  const router = useRouter();
  const seed = useMemo(
    () => parseJudgmentJson(existingJson, units, evidence, methodApplications, structureCompetingExplanations),
    [existingJson, units, evidence, methodApplications, structureCompetingExplanations],
  );
  const [open, setOpen] = useState(variant === "workspace");
  const [conclusions, setConclusions] = useState<Record<string, string>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [conditionsText, setConditionsText] = useState<Record<string, string>>({});
  const [trackingSignals, setTrackingSignals] = useState<Record<string, string>>({});
  const [evidenceRoles, setEvidenceRoles] = useState<Record<string, Record<string, "none" | "support" | "counter">>>({});
  const [uncertainties, setUncertainties] = useState<Record<string, string>>({});
  const [invalidations, setInvalidations] = useState<Record<string, string>>({});
  const [competitions, setCompetitions] = useState<Record<string, string>>({});
  const [sourceExplanationIds, setSourceExplanationIds] = useState<Record<string, string>>({});
  const [discriminators, setDiscriminators] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [confirmedPreconditions, setConfirmedPreconditions] = useState<Record<string, string[]>>({});
  const [statusBadges, setStatusBadges] = useState<Record<string, { strength?: string; decisionStatus?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const evidenceByUnit = useMemo(() => new Map(units.map((unit) => [unit.id, evidence.filter((item) => item.judgment_unit_ids.includes(unit.id))])), [units, evidence]);
  const candidatesByUnit = useMemo(() => {
    const map = new Map<string, Array<{ explanation_id: string; statement: string }>>();
    for (const unit of units) {
      map.set(unit.id, structureCompetingExplanations.filter((item) =>
        item.judgment_unit_ids.length === 0 || item.judgment_unit_ids.includes(unit.id)));
    }
    return map;
  }, [units, structureCompetingExplanations]);

  useEffect(() => {
    const nextConclusions: Record<string, string> = {};
    const nextRationales: Record<string, string> = {};
    const nextConditions: Record<string, string> = {};
    const nextTracking: Record<string, string> = {};
    const nextRoles: Record<string, Record<string, "none" | "support" | "counter">> = {};
    const nextUncertainties: Record<string, string> = {};
    const nextInvalidations: Record<string, string> = {};
    const nextCompetitions: Record<string, string> = {};
    const nextSources: Record<string, string> = {};
    const nextDiscriminators: Record<string, string> = {};
    const nextResolutions: Record<string, string> = {};
    const nextConfirmed: Record<string, string[]> = {};
    const nextBadges: Record<string, { strength?: string; decisionStatus?: string }> = {};
    for (const unit of units) {
      const item = seed[unit.id];
      if (!item) continue;
      nextConclusions[unit.id] = item.conclusion;
      nextRationales[unit.id] = item.rationale;
      nextConditions[unit.id] = item.conditions;
      nextTracking[unit.id] = item.trackingSignals;
      nextRoles[unit.id] = item.evidenceRoles;
      nextUncertainties[unit.id] = item.uncertainties;
      nextInvalidations[unit.id] = item.invalidations;
      nextCompetitions[unit.id] = item.competition;
      nextSources[unit.id] = item.sourceExplanationId;
      nextDiscriminators[unit.id] = item.discriminators;
      nextResolutions[unit.id] = item.resolution;
      nextConfirmed[unit.id] = item.confirmedPreconditions;
      if (item.strength || item.decisionStatus) {
        nextBadges[unit.id] = { strength: item.strength, decisionStatus: item.decisionStatus };
      }
    }
    setConclusions(nextConclusions);
    setRationales(nextRationales);
    setConditionsText(nextConditions);
    setTrackingSignals(nextTracking);
    setEvidenceRoles(nextRoles);
    setUncertainties(nextUncertainties);
    setInvalidations(nextInvalidations);
    setCompetitions(nextCompetitions);
    setSourceExplanationIds(nextSources);
    setDiscriminators(nextDiscriminators);
    setResolutions(nextResolutions);
    setConfirmedPreconditions(nextConfirmed);
    setStatusBadges(nextBadges);
    setMessage("");
  }, [units, seed]);

  const submit = useCallback(async () => {
    const judgments = units.map((unit) => ({
      judgment_unit_id: unit.id,
      conclusion: (conclusions[unit.id] || "").trim(),
      supporting_evidence_draft_ids: Object.entries(evidenceRoles[unit.id] || {}).filter(([, role]) => role === "support").map(([id]) => id),
      counter_evidence_draft_ids: Object.entries(evidenceRoles[unit.id] || {}).filter(([, role]) => role === "counter").map(([id]) => id),
      rationale: (rationales[unit.id] || "").trim() || undefined,
      conditions: lines(conditionsText[unit.id] || ""),
      tracking_signals: lines(trackingSignals[unit.id] || ""),
      uncertainties: lines(uncertainties[unit.id] || ""),
      invalidation_conditions: lines(invalidations[unit.id] || ""),
      competing_explanation: (competitions[unit.id] || "").trim(),
      source_explanation_id: (sourceExplanationIds[unit.id] || "").trim() || undefined,
      discriminating_evidence: lines(discriminators[unit.id] || ""),
      counterevidence_resolution: (resolutions[unit.id] || "").trim(),
      confirmed_precondition_ids: confirmedPreconditions[unit.id] || [],
    }));
    if (!judgments.length || judgments.some((item) => !item.conclusion || !(item.supporting_evidence_draft_ids.length + item.counter_evidence_draft_ids.length) || !item.uncertainties.length || !item.invalidation_conditions.length || !item.competing_explanation || !item.discriminating_evidence.length)) {
      const error = "每个判断单元都必须填写结论、事实角色、不确定性、竞争解释、区分性证据和改判条件。";
      setMessage(error);
      onError?.(error);
      return false;
    }
    setBusy(true);
    onBusyChange?.(true);
    setMessage("");
    onError?.("");
    const response = await fetch(`/api/runs/${runId}/stages/04/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "controlled_judgment_projection", judgments }),
    });
    const result = await response.json();
    setBusy(false);
    onBusyChange?.(false);
    if (!response.ok) {
      const error = result.error || "保存推理逻辑失败";
      setMessage(error);
      onError?.(error);
      return false;
    }
    setMessage("推理逻辑已保存；系统已重算方法执行、强度上限与规则校验。请返回审阅视图逐条确认。");
    router.refresh();
    return true;
  }, [units, conclusions, evidenceRoles, rationales, conditionsText, trackingSignals, uncertainties, invalidations, competitions, sourceExplanationIds, discriminators, resolutions, confirmedPreconditions, runId, router, onBusyChange, onError]);

  useImperativeHandle(ref, () => ({ save: submit }), [submit]);

  const locked = !enabled || busy;
  const formBody = <JudgmentFormBody
    units={units}
    evidenceByUnit={evidenceByUnit}
    candidatesByUnit={candidatesByUnit}
    methodApplications={methodApplications}
    conclusions={conclusions}
    setConclusions={setConclusions}
    rationales={rationales}
    setRationales={setRationales}
    conditionsText={conditionsText}
    setConditionsText={setConditionsText}
    trackingSignals={trackingSignals}
    setTrackingSignals={setTrackingSignals}
    evidenceRoles={evidenceRoles}
    setEvidenceRoles={setEvidenceRoles}
    uncertainties={uncertainties}
    setUncertainties={setUncertainties}
    invalidations={invalidations}
    setInvalidations={setInvalidations}
    competitions={competitions}
    setCompetitions={setCompetitions}
    sourceExplanationIds={sourceExplanationIds}
    setSourceExplanationIds={setSourceExplanationIds}
    discriminators={discriminators}
    setDiscriminators={setDiscriminators}
    resolutions={resolutions}
    setResolutions={setResolutions}
    confirmedPreconditions={confirmedPreconditions}
    setConfirmedPreconditions={setConfirmedPreconditions}
    statusBadges={statusBadges}
    locked={locked}
    message={message}
    variant={variant}
    busy={busy}
    evidence={evidence}
    onSubmit={submit}
  />;

  if (variant === "workspace") return <div className="judgment-form">{formBody}</div>;

  return <section className="card source-acquisition" style={{ marginBottom: 16 }}>
    <JudgmentFallbackPanel open={open} setOpen={setOpen} formBody={formBody} />
  </section>;
});

function JudgmentFallbackPanel({ open, setOpen, formBody }: { open: boolean; setOpen: (value: boolean | ((current: boolean) => boolean)) => void; formBody: ReactNode }) {
  return <>
    <div className="panel-title">
      <div><span>模型裁决失败时的手动路径</span><strong>基于已确认事实形成有边界的判断</strong></div>
      <button type="button" className="button-secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "形成判断草稿"}</button>
    </div>
    {open ? formBody : null}
  </>;
}

function JudgmentUnitHeader({ unit, badge }: { unit: UnitOption; badge?: { strength?: string; decisionStatus?: string } }) {
  return <div className="panel-title" style={{ marginBottom: 8 }}>
    <strong>{unit.title}</strong>
    {badge?.strength ? <span className="workspace-status">{judgmentStrengthLabel(badge.strength)}{badge.decisionStatus ? ` · ${judgmentDecisionStatusLabel(badge.decisionStatus)}` : ""}</span> : null}
  </div>;
}

function JudgmentMethodCard({
  application,
  unitId,
  confirmedPreconditions,
  setConfirmedPreconditions,
  locked,
}: {
  application: MethodApplicationOption;
  unitId: string;
  confirmedPreconditions: Record<string, string[]>;
  setConfirmedPreconditions: Dispatch<SetStateAction<Record<string, string[]>>>;
  locked: boolean;
}) {
  return <div className="card" style={{ marginTop: 8 }}>
    <strong>{researcherLanguage(application.capability_type) || "研究方法"} · 审计记录</strong>
    {application.precondition_checks.length ? application.precondition_checks.map((check) => {
      const automaticallyConfirmed = ["judgment_unit", "object_scope", "controlled_source_verification"].includes(check.precondition_id);
      const checked = automaticallyConfirmed || (confirmedPreconditions[unitId] || []).includes(check.precondition_id);
      return <label key={`${application.application_id}:${check.precondition_id}`}><input type="checkbox" disabled={locked || automaticallyConfirmed} checked={checked} onChange={(event) => {
        const current = confirmedPreconditions[unitId] || [];
        const next = event.target.checked ? [...new Set([...current, check.precondition_id])] : current.filter((id) => id !== check.precondition_id);
        setConfirmedPreconditions({ ...confirmedPreconditions, [unitId]: next });
      }} /> {researcherLanguage(check.reason || check.precondition_id)}{automaticallyConfirmed ? "（已由已确认结构/来源自动满足）" : ""}</label>;
    }) : <p className="muted">该方法没有登记额外前置条件。</p>}
  </div>;
}

function JudgmentFormBody({
  units,
  evidenceByUnit,
  candidatesByUnit,
  methodApplications,
  conclusions,
  setConclusions,
  rationales,
  setRationales,
  conditionsText,
  setConditionsText,
  trackingSignals,
  setTrackingSignals,
  evidenceRoles,
  setEvidenceRoles,
  uncertainties,
  setUncertainties,
  invalidations,
  setInvalidations,
  competitions,
  setCompetitions,
  sourceExplanationIds,
  setSourceExplanationIds,
  discriminators,
  setDiscriminators,
  resolutions,
  setResolutions,
  confirmedPreconditions,
  setConfirmedPreconditions,
  statusBadges,
  locked,
  message,
  variant,
  busy,
  evidence,
  onSubmit,
}: {
  units: UnitOption[];
  evidenceByUnit: Map<string, EvidenceOption[]>;
  candidatesByUnit: Map<string, Array<{ explanation_id: string; statement: string }>>;
  methodApplications: MethodApplicationOption[];
  conclusions: Record<string, string>;
  setConclusions: Dispatch<SetStateAction<Record<string, string>>>;
  rationales: Record<string, string>;
  setRationales: Dispatch<SetStateAction<Record<string, string>>>;
  conditionsText: Record<string, string>;
  setConditionsText: Dispatch<SetStateAction<Record<string, string>>>;
  trackingSignals: Record<string, string>;
  setTrackingSignals: Dispatch<SetStateAction<Record<string, string>>>;
  evidenceRoles: Record<string, Record<string, "none" | "support" | "counter">>;
  setEvidenceRoles: Dispatch<SetStateAction<Record<string, Record<string, "none" | "support" | "counter">>>>;
  uncertainties: Record<string, string>;
  setUncertainties: Dispatch<SetStateAction<Record<string, string>>>;
  invalidations: Record<string, string>;
  setInvalidations: Dispatch<SetStateAction<Record<string, string>>>;
  competitions: Record<string, string>;
  setCompetitions: Dispatch<SetStateAction<Record<string, string>>>;
  sourceExplanationIds: Record<string, string>;
  setSourceExplanationIds: Dispatch<SetStateAction<Record<string, string>>>;
  discriminators: Record<string, string>;
  setDiscriminators: Dispatch<SetStateAction<Record<string, string>>>;
  resolutions: Record<string, string>;
  setResolutions: Dispatch<SetStateAction<Record<string, string>>>;
  confirmedPreconditions: Record<string, string[]>;
  setConfirmedPreconditions: Dispatch<SetStateAction<Record<string, string[]>>>;
  statusBadges: Record<string, { strength?: string; decisionStatus?: string }>;
  locked: boolean;
  message: string;
  variant: "workspace" | "fallback";
  busy: boolean;
  evidence: EvidenceOption[];
  onSubmit: () => Promise<boolean>;
}) {
  return <div>
    <p className="muted">结论与推理要点由研究员填写；竞争解释优先使用结构阶段已登记的候选。系统只使用已确认事实，并按规则重算结论强度与适用边界。</p>
    {units.map((unit, unitIndex) => {
      const candidates = candidatesByUnit.get(unit.id) || [];
      const badge = statusBadges[unit.id];
      const unitEvidence = evidenceByUnit.get(unit.id) || [];
      const usedEvidenceCount = Object.values(evidenceRoles[unit.id] || {}).filter((role) => role !== "none").length;
      const missing = [
        !(conclusions[unit.id] || "").trim() ? "结论" : "",
        usedEvidenceCount === 0 ? "事实角色" : "",
        !(uncertainties[unit.id] || "").trim() ? "不确定性" : "",
        !(invalidations[unit.id] || "").trim() ? "改判条件" : "",
        !(competitions[unit.id] || "").trim() ? "竞争解释" : "",
        !(discriminators[unit.id] || "").trim() ? "区分性证据" : "",
      ].filter(Boolean);
      const compactEvidence = (statement: string) => {
        const normalized = researcherLanguage(statement).replace(/\s+/g, " ").trim();
        return normalized.length > 180 ? `${normalized.slice(0, 180).trimEnd()}…` : normalized;
      };
      return <details className="card judgment-unit-editor" key={unit.id} open={unitIndex === 0}>
        <summary>
          <span>判断 {unitIndex + 1}</span>
          <strong>{unit.title}</strong>
          <em className={missing.length ? "incomplete" : "complete"}>
            {missing.length ? `待补 ${missing.length} 项` : "要素齐全"}
          </em>
        </summary>
        <div className="judgment-unit-editor-body">
          <JudgmentUnitHeader unit={unit} badge={badge} />
          <div className="judgment-editor-progress">
            <span>已选择 {usedEvidenceCount}/{unitEvidence.length} 项事实</span>
            {missing.length ? <span>还需：{missing.join("、")}</span> : <strong>可保存并执行规则重算</strong>}
          </div>
          <div className="field"><label>方向结论</label><textarea disabled={locked} value={conclusions[unit.id] || ""} onChange={(event) => setConclusions({ ...conclusions, [unit.id]: event.target.value })} /></div>
          <div className="field"><label>推理要点</label><textarea disabled={locked} value={rationales[unit.id] || ""} onChange={(event) => setRationales({ ...rationales, [unit.id]: event.target.value })} placeholder="说明为何由这些事实得到该结论；强度仍由系统重算" /></div>
          <details className="judgment-evidence-picker" open={usedEvidenceCount === 0}>
            <summary>选择事实角色 · 已选 {usedEvidenceCount}/{unitEvidence.length}</summary>
            <div className="field"><label>使用的已确认事实及其相对结论角色</label>{unitEvidence.map((item) => <div className="evidence-role-row" key={item.id}><select disabled={locked} value={evidenceRoles[unit.id]?.[item.id] || "none"} onChange={(event) => setEvidenceRoles({ ...evidenceRoles, [unit.id]: { ...(evidenceRoles[unit.id] || {}), [item.id]: event.target.value as "none" | "support" | "counter" } })}><option value="none">不使用</option><option value="support">支持结论</option><option value="counter">反证 / 限制结论</option></select><span title={researcherLanguage(item.statement)}>{compactEvidence(item.statement)}{item.direction ? `（证据阶段：${({ support: "支持", weaken: "削弱", neutral: "中性" } as Record<string, string>)[item.direction] || item.direction}）` : ""}</span></div>)}</div>
          </details>
        <details className="source-tech-details">
          <summary>审计：方法适用条件</summary>
          <div className="field"><label>只勾选可由当前结构和已确认事实确认的条件</label>
            {methodApplications.filter((application) => application.target_judgment_unit_refs.includes(unit.id)).map((application) => <JudgmentMethodCard key={application.application_id} application={application} unitId={unit.id} confirmedPreconditions={confirmedPreconditions} setConfirmedPreconditions={setConfirmedPreconditions} locked={locked} />)}
            {!methodApplications.some((application) => application.target_judgment_unit_refs.includes(unit.id)) ? <div className="notice">该关键判断还没有登记可用的取证或裁决方法，暂不能形成可交付判断。</div> : null}
          </div>
        </details>
        <div className="source-form-grid">
          <div className="field"><label>不确定性（每行一条）</label><textarea disabled={locked} value={uncertainties[unit.id] || ""} onChange={(event) => setUncertainties({ ...uncertainties, [unit.id]: event.target.value })} /></div>
          <div className="field"><label>改判条件（每行一条）</label><textarea disabled={locked} value={invalidations[unit.id] || ""} onChange={(event) => setInvalidations({ ...invalidations, [unit.id]: event.target.value })} /></div>
          <div className="field">
            <label>竞争解释{candidates.length ? "（来自结构阶段候选）" : ""}</label>
            {candidates.length ? (
              <select
                disabled={locked}
                value={sourceExplanationIds[unit.id] || candidates[0]?.explanation_id || ""}
                onChange={(event) => {
                  const selected = candidates.find((item) => item.explanation_id === event.target.value);
                  setSourceExplanationIds({ ...sourceExplanationIds, [unit.id]: event.target.value });
                  if (selected) setCompetitions({ ...competitions, [unit.id]: selected.statement });
                }}
              >
                {candidates.map((item, index) => <option key={item.explanation_id} value={item.explanation_id}>候选 {index + 1} · {researcherLanguage(item.statement)}</option>)}
              </select>
            ) : <p className="muted">结构阶段尚未为本项判断登记竞争解释；请手写一条，并回到结构页补充。</p>}
            <textarea disabled={locked} value={competitions[unit.id] || ""} onChange={(event) => setCompetitions({ ...competitions, [unit.id]: event.target.value })} />
          </div>
          <div className="field"><label>区分性证据（每行一条）</label><textarea disabled={locked} value={discriminators[unit.id] || ""} onChange={(event) => setDiscriminators({ ...discriminators, [unit.id]: event.target.value })} /></div><div className="field"><label>适用边界补充（每行一条，可选）</label><textarea disabled={locked} value={conditionsText[unit.id] || ""} onChange={(event) => setConditionsText({ ...conditionsText, [unit.id]: event.target.value })} /></div>
          <div className="field"><label>跟踪信号（每行一条，可选）</label><textarea disabled={locked} value={trackingSignals[unit.id] || ""} onChange={(event) => setTrackingSignals({ ...trackingSignals, [unit.id]: event.target.value })} placeholder="下一步要盯什么指标或事件" /></div>
        </div>
        <div className="field"><label>反证如何被解决（可留空；若支持与反证并存且留空，系统将结论标为「暂不可判断 / 存在争议」）</label><textarea disabled={locked} value={resolutions[unit.id] || ""} onChange={(event) => setResolutions({ ...resolutions, [unit.id]: event.target.value })} /></div>
        </div>
      </details>;
    })}
    {message ? <div className="notice">{message}</div> : null}
    {variant === "fallback" ? <button type="button" className="button" disabled={busy || locked || !units.length || !evidence.length} onClick={() => void onSubmit()}>{busy ? "正在执行规则与方法…" : "生成待核对判断草稿"}</button> : null}
  </div>;
}
