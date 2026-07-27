"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  judgmentDecisionStatusLabel,
  judgmentStrengthLabel,
  researcherLanguage,
  researcherMarkdown,
} from "@/app/lib/researcher-stage-output";
import type { ApprovedScopeSummary, EvidenceOption, MethodApplicationOption, SourceOption, UnitOption } from "./types";
import { asItemList, lines } from "./helpers";

type StructureUnitDraft = {
  id: string;
  title: string;
  question: string;
  judgment_type: string;
  evidence_requirements: string[];
};

type StructureCandidateDraft = {
  id: string;
  statement: string;
  judgment_unit_ids: string[];
  discriminating_evidence: string[];
};

const JUDGMENT_TYPE_OPTIONS = [
  ["state_measurement", "状态测量"],
  ["trend_direction", "趋势方向"],
  ["cycle_phase", "周期阶段"],
  ["mechanism_validation", "机制验证"],
  ["causal_attribution", "原因归因"],
  ["transmission_path", "传导路径"],
  ["object_differentiation", "对象分化"],
  ["impact_realization", "影响兑现"],
  ["expectation_gap", "预期差"],
  ["valuation_impact", "估值影响"],
] as const;

function emptyStructureUnit(index = 0, existingIds: string[] = []): StructureUnitDraft {
  let n = index + 1;
  const existing = new Set(existingIds);
  while (existing.has(`JU-CONTROLLED-${String(n).padStart(2, "0")}`)) n += 1;
  return {
    id: `JU-CONTROLLED-${String(n).padStart(2, "0")}`,
    title: "",
    question: "",
    judgment_type: "cycle_phase",
    evidence_requirements: [""],
  };
}

function emptyCandidate(prefix: "CE" | "CD", index: number): StructureCandidateDraft {
  return {
    id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    statement: "",
    judgment_unit_ids: [],
    discriminating_evidence: prefix === "CE" ? [""] : [],
  };
}

function parseCandidateList(value: unknown, prefix: "CE" | "CD", minimum: number): StructureCandidateDraft[] {
  const items = Array.isArray(value) ? value : [];
  const parsed = items.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
        statement: researcherLanguage(item),
        judgment_unit_ids: [] as string[],
        discriminating_evidence: prefix === "CE" ? [""] : [],
      };
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const discriminating = Array.isArray(record.discriminating_evidence)
        ? record.discriminating_evidence.map(String)
        : Array.isArray(record.discriminating_evidence_requirements)
          ? record.discriminating_evidence_requirements.map(String)
          : [];
      return {
        id: String(record.explanation_id || record.direction_id || record.id || `${prefix}-${String(index + 1).padStart(2, "0")}`),
        statement: researcherLanguage(record.statement),
        judgment_unit_ids: Array.isArray(record.judgment_unit_ids) ? record.judgment_unit_ids.map(String) : [],
        discriminating_evidence: prefix === "CE"
          ? (discriminating.length ? discriminating.map(researcherLanguage) : [""])
          : [],
      };
    }
    return emptyCandidate(prefix, index);
  });
  while (parsed.length < minimum) parsed.push(emptyCandidate(prefix, parsed.length));
  return parsed.length ? parsed : [emptyCandidate(prefix, 0)];
}

function parseStructureJson(existingJson: string | undefined) {
  let existing: any = {};
  try { existing = JSON.parse(existingJson || "{}"); } catch { existing = {}; }
  const units = Array.isArray(existing.judgment_units) && existing.judgment_units.length
    ? existing.judgment_units.map((unit: any, index: number) => ({
      id: String(unit.id || `JU-CONTROLLED-${String(index + 1).padStart(2, "0")}`),
      title: researcherLanguage(unit.title),
      question: researcherLanguage(unit.question),
      judgment_type: String(unit.judgment_type || "cycle_phase"),
      evidence_requirements: asItemList(unit.evidence_requirements, 1).map(researcherLanguage),
    }))
    : [emptyStructureUnit()];
  return {
    scopeLabel: String(existing.research_scope?.label || ""),
    units,
    counterDirections: parseCandidateList(existing.counter_evidence_directions, "CD", 1),
    competingExplanations: parseCandidateList(existing.competing_explanations, "CE", 1),
  };
}

function clip(text: string, max = 72) {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatAsOf(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || raw;
}

function deriveScopeLabel(seedLabel: string, approvedScope?: ApprovedScopeSummary) {
  if (seedLabel.trim()) return seedLabel.trim();
  const derived = [approvedScope?.coreObject, approvedScope?.judgmentAction]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("；");
  return derived;
}
export type ControlledStructureProjectionFormHandle = {
  save: () => Promise<boolean>;
};

export const ControlledStructureProjectionForm = forwardRef<ControlledStructureProjectionFormHandle, {
  runId: string;
  existingJson?: string;
  enabled: boolean;
  variant?: "workspace" | "fallback";
  approvedScope?: ApprovedScopeSummary;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: string) => void;
}>(function ControlledStructureProjectionForm({
  runId,
  existingJson,
  enabled,
  variant = "workspace",
  approvedScope,
  onBusyChange,
  onError,
}, ref) {
  const router = useRouter();
  const seed = useMemo(() => parseStructureJson(existingJson), [existingJson]);
  const [units, setUnits] = useState<StructureUnitDraft[]>(seed.units);
  const [counterDirections, setCounterDirections] = useState<StructureCandidateDraft[]>(seed.counterDirections);
  const [competingExplanations, setCompetingExplanations] = useState<StructureCandidateDraft[]>(seed.competingExplanations);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(variant === "workspace");
  const hasExisting = Boolean(existingJson && existingJson !== "{}");

  useEffect(() => {
    const next = parseStructureJson(existingJson);
    setUnits(next.units);
    setCounterDirections(next.counterDirections);
    setCompetingExplanations(next.competingExplanations);
    setMessage("");
  }, [existingJson]);

  const submit = useCallback(async () => {
    const resolvedScopeLabel = deriveScopeLabel(seed.scopeLabel, approvedScope);
    const structure = {
      scope_label: resolvedScopeLabel,
      units: units.map((unit, index) => ({
        id: (unit.id || `JU-CONTROLLED-${String(index + 1).padStart(2, "0")}`).trim(),
        title: unit.title.trim(),
        question: unit.question.trim(),
        judgment_type: unit.judgment_type,
        evidence_requirements: unit.evidence_requirements.map((item) => item.trim()).filter(Boolean),
      })),
      counter_evidence_directions: counterDirections
        .map((item, index) => ({
          direction_id: item.id || `CD-${String(index + 1).padStart(2, "0")}`,
          statement: item.statement.trim(),
          judgment_unit_ids: item.judgment_unit_ids,
        }))
        .filter((item) => item.statement),
      competing_explanations: competingExplanations
        .map((item, index) => ({
          explanation_id: item.id || `CE-${String(index + 1).padStart(2, "0")}`,
          statement: item.statement.trim(),
          judgment_unit_ids: item.judgment_unit_ids,
          discriminating_evidence: item.discriminating_evidence.map((value) => value.trim()).filter(Boolean),
        }))
        .filter((item) => item.statement),
    };
    if (
      structure.units.some((unit) => !unit.title || !unit.question || !unit.evidence_requirements.length)
      || !structure.counter_evidence_directions.length
      || !structure.competing_explanations.length
      || structure.competing_explanations.some((item) => !item.discriminating_evidence.length)
    ) {
      const hint = "请补全：每个判断单元的标题/问题/必要证据，以及至少一条反向证据与竞争解释（含区分性证据）。";
      setMessage(hint);
      onError?.(hint);
      return false;
    }
    setBusy(true);
    onBusyChange?.(true);
    setMessage("");
    try {
      const response = await fetch(`/api/runs/${runId}/stages/02/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "controlled_structure_projection", structure }),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = result.error || "研究结构保存失败";
        setMessage(error);
        onError?.(error);
        return false;
      }
      setMessage(hasExisting
        ? "研究结构已更新；方法登记与可读稿已同步，请审阅后确认。"
        : "研究结构已写入；每个判断单元均已登记结构、取证和裁决方法，请审阅后确认。");
      router.refresh();
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      onError?.(text);
      return false;
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }, [
    units, counterDirections, competingExplanations,
    seed.scopeLabel, approvedScope,
    runId, router, onBusyChange, onError, hasExisting,
  ]);

  useImperativeHandle(ref, () => ({ save: submit }), [submit]);

  const locked = !enabled || busy;
  const hasScopePin = Boolean(
    approvedScope?.coreObject || approvedScope?.judgmentAction || approvedScope?.asOf,
  );

  const formBody = <div className="scope-form structure-form">
    {hasScopePin ? (
      <div className="scope-pin">
        <div className="scope-pin-head">
          <strong>已确认范围</strong>
          <Link className="scope-pin-link" href={`/runs/${runId}/stages/1`}>改范围 → 阶段 01</Link>
        </div>
        <dl className="scope-pin-grid">
          {approvedScope?.coreObject ? <div><dt>对象</dt><dd title={approvedScope.coreObject}>{clip(approvedScope.coreObject, 56)}</dd></div> : null}
          {approvedScope?.judgmentAction ? <div><dt>判断</dt><dd title={approvedScope.judgmentAction}>{clip(approvedScope.judgmentAction, 56)}</dd></div> : null}
          {approvedScope?.asOf ? <div><dt>截止</dt><dd>{formatAsOf(approvedScope.asOf)}</dd></div> : null}
        </dl>
      </div>
    ) : (
      <p className="scope-form-lead">请先确认范围阶段。若需拆分或新增关键判断，请返回研究总览使用“修改研究”；本页可直接调整必要证据与反证/竞争。</p>
    )}

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>判断单元</strong>
        <span>标题、问题和类型只读 · 必要证据可直接调整 · 结构增删请返回研究总览</span>
      </header>
      <div className="structure-unit-list">
        {units.map((unit, index) => (
          <div className="structure-unit-card" key={unit.id || index}>
            <div className="structure-unit-head">
              <span className="structure-unit-id">关键判断 {String(index + 1).padStart(2, "0")}</span>
            </div>
            <div className="structure-unit-grid">
              <div className="field structure-field-title">
                <label>标题</label>
                <p className="structure-readonly">{unit.title || "（空）"}</p>
              </div>
              <div className="field structure-field-type">
                <label>判断类型</label>
                <p className="structure-readonly">
                  {JUDGMENT_TYPE_OPTIONS.find(([value]) => value === unit.judgment_type)?.[1] || unit.judgment_type}
                </p>
              </div>
              <div className="field structure-field-question">
                <label>原子判断问题</label>
                <p className="structure-readonly structure-readonly-block">{unit.question || "（空）"}</p>
              </div>
              <div className="field structure-field-evidence">
                <label>必要证据</label>
                <div className="scope-item-list">
                  {unit.evidence_requirements.map((item, requirementIndex) => (
                    <div className="scope-item-row" key={`${unit.id}-er-${requirementIndex}`}>
                      <input
                        type="text"
                        className="scope-item-input"
                        value={item}
                        disabled={locked}
                        onChange={(event) => setUnits(units.map((draft, itemIndex) => {
                          if (itemIndex !== index) return draft;
                          return {
                            ...draft,
                            evidence_requirements: draft.evidence_requirements.map((value, valueIndex) => valueIndex === requirementIndex ? event.target.value : value),
                          };
                        }))}
                        placeholder={requirementIndex === 0 ? "例如：同口径价格序列" : "再写一条证据要求"}
                      />
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={locked || unit.evidence_requirements.length <= 1}
                        onClick={() => setUnits(units.map((draft, itemIndex) => itemIndex === index
                          ? { ...draft, evidence_requirements: draft.evidence_requirements.filter((_, valueIndex) => valueIndex !== requirementIndex) }
                          : draft))}
                      >删除</button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button-secondary scope-item-add"
                    disabled={locked}
                    onClick={() => setUnits(units.map((draft, itemIndex) => itemIndex === index
                      ? { ...draft, evidence_requirements: [...draft.evidence_requirements, ""] }
                      : draft))}
                  >＋ 证据要求</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>反向证据与竞争解释</strong>
        <span>可挂到一个或多个判断单元；不挂则标为待归属，确认前必须主动寻找</span>
      </header>
      <div className="structure-counter-stack">
        <div className="field">
          <label>反向证据方向</label>
          <div className="scope-item-list">
            {counterDirections.map((item, index) => (
              <div className="structure-candidate-card" key={item.id || `counter-${index}`}>
                <div className="scope-item-row">
                  <input
                    type="text"
                    className="scope-item-input"
                    value={item.statement}
                    disabled={locked}
                    onChange={(event) => setCounterDirections(counterDirections.map((value, itemIndex) => itemIndex === index ? { ...value, statement: event.target.value } : value))}
                    placeholder={index === 0 ? "例如：库存回升或现货需求谨慎" : "再写一条反向证据方向"}
                  />
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={locked || counterDirections.length <= 1}
                    onClick={() => setCounterDirections(counterDirections.filter((_, itemIndex) => itemIndex !== index))}
                  >删除</button>
                </div>
                <div className="structure-candidate-units">
                  <span className="muted">{item.judgment_unit_ids.length ? "挂接判断单元" : "待归属"}</span>
                  {units.map((unit) => (
                    <label key={`${item.id}-${unit.id}`}>
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={item.judgment_unit_ids.includes(unit.id)}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...new Set([...item.judgment_unit_ids, unit.id])]
                            : item.judgment_unit_ids.filter((id) => id !== unit.id);
                          setCounterDirections(counterDirections.map((value, itemIndex) => itemIndex === index ? { ...value, judgment_unit_ids: nextIds } : value));
                        }}
                      /> {unit.title || `关键判断 ${units.findIndex((row) => row.id === unit.id) + 1}`}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <button type="button" className="button-secondary scope-item-add" disabled={locked} onClick={() => setCounterDirections([...counterDirections, emptyCandidate("CD", counterDirections.length)])}>＋ 反向证据</button>
          </div>
        </div>
        <div className="field">
          <label>竞争解释</label>
          <div className="scope-item-list">
            {competingExplanations.map((item, index) => (
              <div className="structure-candidate-card" key={item.id || `compete-${index}`}>
                <div className="scope-item-row">
                  <input
                    type="text"
                    className="scope-item-input"
                    value={item.statement}
                    disabled={locked}
                    onChange={(event) => setCompetingExplanations(competingExplanations.map((value, itemIndex) => itemIndex === index ? { ...value, statement: event.target.value } : value))}
                    placeholder={index === 0 ? "例如：关税宽限期触发提前采购" : "再写一条竞争解释"}
                  />
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={locked || competingExplanations.length <= 1}
                    onClick={() => setCompetingExplanations(competingExplanations.filter((_, itemIndex) => itemIndex !== index))}
                  >删除</button>
                </div>
                <textarea
                  className="scope-item-input"
                  rows={2}
                  value={item.discriminating_evidence.join("\n")}
                  disabled={locked}
                  onChange={(event) => setCompetingExplanations(competingExplanations.map((value, itemIndex) => itemIndex === index
                    ? { ...value, discriminating_evidence: event.target.value.split("\n") }
                    : value))}
                  placeholder={"区分性证据要求，每行一条\n例如：同口径跨季库存与终端需求对照"}
                />
                <div className="structure-candidate-units">
                  <span className="muted">{item.judgment_unit_ids.length ? "挂接判断单元" : "待归属"}</span>
                  {units.map((unit) => (
                    <label key={`${item.id}-${unit.id}`}>
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={item.judgment_unit_ids.includes(unit.id)}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...new Set([...item.judgment_unit_ids, unit.id])]
                            : item.judgment_unit_ids.filter((id) => id !== unit.id);
                          setCompetingExplanations(competingExplanations.map((value, itemIndex) => itemIndex === index ? { ...value, judgment_unit_ids: nextIds } : value));
                        }}
                      /> {unit.title || `关键判断 ${units.findIndex((row) => row.id === unit.id) + 1}`}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <button type="button" className="button-secondary scope-item-add" disabled={locked} onClick={() => setCompetingExplanations([...competingExplanations, emptyCandidate("CE", competingExplanations.length)])}>＋ 竞争解释</button>
          </div>
        </div>
      </div>
    </section>

    {message ? <div className="notice">{message}</div> : null}
    {variant === "fallback" ? (
      <button type="button" className="button" disabled={locked} onClick={submit}>
        {busy ? "正在保存…" : hasExisting ? "保存研究结构" : "生成待审阅研究结构"}
      </button>
    ) : null}
  </div>;

  if (variant === "fallback") {
    return <section className="card source-acquisition">
      <div className="panel-title">
        <div>
          <span>模型不可用时的手动路径</span>
          <strong>审阅必要证据与反证/竞争；结构调整请返回研究总览</strong>
        </div>
        <button type="button" className="button-secondary" disabled={!enabled} onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : hasExisting ? "编辑研究结构" : "建立研究结构"}
        </button>
      </div>
      <p className="muted">本页可直接调整必要证据与反证/竞争；如需增删关键判断或改标题、问题，请返回研究总览使用“修改研究”。</p>
      {open ? formBody : null}
    </section>;
  }

  return formBody;
});
