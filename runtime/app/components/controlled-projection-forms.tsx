"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type UnitOption = { id: string; title: string; ontology_node_ids?: string[] };
type SourceOption = { id: string; title: string; publisher: string; published_at: string | null };
type EvidenceOption = { id: string; statement: string; judgment_unit_ids: string[]; direction?: string };
type MethodApplicationOption = {
  application_id: string;
  method_id: string;
  capability_type: string;
  target_judgment_unit_refs: string[];
  precondition_checks: Array<{ precondition_id: string; reason?: string }>;
};

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function asItemList(value: unknown, minimum: number): string[] {
  const items = Array.isArray(value)
    ? value.map((item) => String(item ?? ""))
    : typeof value === "string"
      ? value.split("\n")
      : [];
  const normalized = items.map((item) => item.trimEnd());
  while (normalized.length < minimum) normalized.push("");
  return normalized.length ? normalized : Array.from({ length: minimum }, () => "");
}

function parseScopeJson(existingJson: string | undefined, question: string) {
  let existing: any = {};
  try { existing = JSON.parse(existingJson || "{}"); } catch { existing = {}; }
  return {
    normalizedQuestion: String(existing.normalized_question || question || ""),
    coreObject: String(existing.core_object || ""),
    judgmentAction: String(existing.judgment_action || ""),
    lookback: String(existing.time_scope?.lookback || ""),
    asOf: String(existing.time_scope?.as_of || ""),
    forward: String(existing.time_scope?.forward || ""),
    boundaries: asItemList(existing.boundaries, 2),
    exclusions: asItemList(existing.exclusions, 1),
  };
}

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
        statement: item,
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
        statement: String(record.statement || ""),
        judgment_unit_ids: Array.isArray(record.judgment_unit_ids) ? record.judgment_unit_ids.map(String) : [],
        discriminating_evidence: prefix === "CE" ? (discriminating.length ? discriminating : [""]) : [],
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
      title: String(unit.title || ""),
      question: String(unit.question || ""),
      judgment_type: String(unit.judgment_type || "cycle_phase"),
      evidence_requirements: asItemList(unit.evidence_requirements, 1),
    }))
    : [emptyStructureUnit()];
  return {
    scopeLabel: String(existing.research_scope?.label || ""),
    units,
    counterDirections: parseCandidateList(existing.counter_evidence_directions, "CD", 1),
    competingExplanations: parseCandidateList(existing.competing_explanations, "CE", 1),
  };
}

export type ApprovedScopeSummary = {
  coreObject: string;
  judgmentAction: string;
  asOf: string;
  lookback: string;
  forward: string;
};

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

export type ControlledScopeProjectionFormHandle = {
  save: () => Promise<boolean>;
};

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
      <p className="scope-form-lead">请先确认 Stage01 研究范围。结构增删请用右下角改稿；本页手改仅限必要证据与反证/竞争。</p>
    )}

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>判断单元</strong>
        <span>标题/问题/类型只读 · 仅必要证据可手改 · 结构增删请用右下角改稿</span>
      </header>
      <div className="structure-unit-list">
        {units.map((unit, index) => (
          <div className="structure-unit-card" key={unit.id || index}>
            <div className="structure-unit-head">
              <span className="structure-unit-id">{unit.id || `判断单元 ${String(index + 1).padStart(2, "0")}`}</span>
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
                      /> {unit.id}
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
                      /> {unit.id}
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
          <strong>审阅必要证据与反证/竞争；结构改用右下角改稿</strong>
        </div>
        <button type="button" className="button-secondary" disabled={!enabled} onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : hasExisting ? "编辑研究结构" : "建立研究结构"}
        </button>
      </div>
      <p className="muted">手改仅限必要证据与反证/竞争；增删单元或改标题/问题请用右下角改稿。</p>
      {open ? formBody : null}
    </section>;
  }

  return formBody;
});


export const ControlledScopeProjectionForm = forwardRef<ControlledScopeProjectionFormHandle, {
  runId: string;
  question: string;
  existingJson?: string;
  enabled: boolean;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: string) => void;
}>(function ControlledScopeProjectionForm({ runId, question, existingJson, enabled, onBusyChange, onError }, ref) {
  const router = useRouter();
  const seed = useMemo(() => parseScopeJson(existingJson, question), [existingJson, question]);
  const [normalizedQuestion, setNormalizedQuestion] = useState(seed.normalizedQuestion);
  const [coreObject, setCoreObject] = useState(seed.coreObject);
  const [judgmentAction, setJudgmentAction] = useState(seed.judgmentAction);
  const [lookback, setLookback] = useState(seed.lookback);
  const [asOf, setAsOf] = useState(seed.asOf);
  const [forward, setForward] = useState(seed.forward);
  const [boundaries, setBoundaries] = useState<string[]>(seed.boundaries);
  const [exclusions, setExclusions] = useState<string[]>(seed.exclusions);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const next = parseScopeJson(existingJson, question);
    setNormalizedQuestion(next.normalizedQuestion);
    setCoreObject(next.coreObject);
    setJudgmentAction(next.judgmentAction);
    setLookback(next.lookback);
    setAsOf(next.asOf);
    setForward(next.forward);
    setBoundaries(next.boundaries);
    setExclusions(next.exclusions);
    setMessage("");
  }, [existingJson, question]);

  const submit = useCallback(async () => {
    const scope = {
      normalized_question: normalizedQuestion.trim(),
      core_object: coreObject.trim(),
      judgment_action: judgmentAction.trim(),
      lookback: lookback.trim(),
      as_of: asOf.trim(),
      forward: forward.trim(),
      boundaries: boundaries.map((item) => item.trim()).filter(Boolean),
      exclusions: exclusions.map((item) => item.trim()).filter(Boolean),
    };
    if (!scope.normalized_question || !scope.core_object || !scope.judgment_action || !scope.lookback || !scope.as_of || !scope.forward || scope.boundaries.length < 2 || !scope.exclusions.length) {
      const hint = "请按四层补全：研究问题、对象与判断动作、时间三件套；边界至少两条，排除项至少一条。";
      setMessage(hint);
      onError?.(hint);
      return false;
    }
    setBusy(true);
    onBusyChange?.(true);
    setMessage("");
    try {
      const response = await fetch(`/api/runs/${runId}/stages/01/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "deterministic_projection", scope }),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = result.error || "研究范围保存失败";
        setMessage(error);
        onError?.(error);
        return false;
      }
      setMessage("研究范围已写入后台；可读稿已同步，请审阅后确认。");
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
    normalizedQuestion, coreObject, judgmentAction, lookback, asOf, forward, boundaries, exclusions,
    runId, router, onBusyChange, onError,
  ]);

  useImperativeHandle(ref, () => ({ save: submit }), [submit]);

  const locked = !enabled || busy;

  return <div className="scope-form">
    <p className="scope-form-lead">按四层填写：研究问题 → 判断对象与动作 → 时间框 → 边界。这里只定义任务，不写事实或结论。</p>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>1. 研究问题</strong>
        <span>整次任务要回答的完整问句</span>
      </header>
      <div className="field">
        <label>改写后的研究问题</label>
        <textarea value={normalizedQuestion} disabled={locked} onChange={(event) => setNormalizedQuestion(event.target.value)} placeholder="写成可验证、可反证的完整问句；后续阶段不得偷换此题" />
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>2. 判断什么</strong>
        <span>把问题拆成「对象」和「动作」</span>
      </header>
      <div className="scope-pair">
        <div className="field">
          <div className="field-meta">
            <label>核心对象与口径</label>
            <span className="field-hint">判断谁；有比较则写清比较对象</span>
          </div>
          <textarea value={coreObject} disabled={locked} onChange={(event) => setCoreObject(event.target.value)} placeholder="例如：全球存储芯片中的 HBM、非 HBM DRAM、NAND" />
        </div>
        <div className="field">
          <div className="field-meta">
            <label>判断动作</label>
            <span className="field-hint">对对象做什么判断</span>
          </div>
          <textarea value={judgmentAction} disabled={locked} onChange={(event) => setJudgmentAction(event.target.value)} placeholder="例如：定位周期阶段，并给出延续/转向的条件" />
        </div>
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>3. 时间框</strong>
        <span>截止时点是「现在」；回看/前瞻都相对它</span>
      </header>
      <div className="scope-time">
        <div className="field">
          <div className="field-meta">
            <label>回看期</label>
            <span className="field-hint">从截止时点往回看多远</span>
          </div>
          <textarea className="scope-compact" value={lookback} disabled={locked} onChange={(event) => setLookback(event.target.value)} placeholder="例如：最近六个完整季度" />
        </div>
        <div className="field scope-time-anchor">
          <div className="field-meta">
            <label>截止时点（当前锚点）</label>
            <span className="field-hint">只用到这一天（含）已公开信息</span>
          </div>
          <textarea className="scope-compact" value={asOf} disabled={locked} onChange={(event) => setAsOf(event.target.value)} placeholder="例如：2025年上半年" />
        </div>
        <div className="field">
          <div className="field-meta">
            <label>前瞻期</label>
            <span className="field-hint">从截止时点往前看多远</span>
          </div>
          <textarea className="scope-compact" value={forward} disabled={locked} onChange={(event) => setForward(event.target.value)} placeholder="例如：未来 6—24 个月" />
        </div>
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>4. 边界</strong>
        <span>边界写本次要做的；排除项写明确不做的</span>
      </header>
      <div className="scope-pair">
        <div className="field">
          <div className="field-meta">
            <label>研究边界</label>
            <span className="field-hint">每条一个输入框 · 至少两条</span>
          </div>
          <div className="scope-item-list">
            {boundaries.map((item, index) => (
              <div className="scope-item-row" key={`boundary-${index}`}>
                <textarea
                  className="scope-item-input"
                  value={item}
                  disabled={locked}
                  onChange={(event) => setBoundaries(boundaries.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                  placeholder={index === 0 ? "例如：只判断行业供需与产品价格周期" : "再写一条边界"}
                />
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked || boundaries.length <= 2}
                  onClick={() => setBoundaries(boundaries.filter((_, itemIndex) => itemIndex !== index))}
                >删除</button>
              </div>
            ))}
            <button type="button" className="button-secondary scope-item-add" disabled={locked} onClick={() => setBoundaries([...boundaries, ""])}>＋ 添加边界</button>
          </div>
        </div>
        <div className="field">
          <div className="field-meta">
            <label>排除项</label>
            <span className="field-hint">每条一个输入框 · 至少一条</span>
          </div>
          <div className="scope-item-list">
            {exclusions.map((item, index) => (
              <div className="scope-item-row" key={`exclusion-${index}`}>
                <textarea
                  className="scope-item-input"
                  value={item}
                  disabled={locked}
                  onChange={(event) => setExclusions(exclusions.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                  placeholder={index === 0 ? "例如：不做个股评级或目标价" : "再写一条排除项"}
                />
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked || exclusions.length <= 1}
                  onClick={() => setExclusions(exclusions.filter((_, itemIndex) => itemIndex !== index))}
                >删除</button>
              </div>
            ))}
            <button type="button" className="button-secondary scope-item-add" disabled={locked} onClick={() => setExclusions([...exclusions, ""])}>＋ 添加排除项</button>
          </div>
        </div>
      </div>
    </section>

    {message ? <div className="notice">{message}</div> : null}
  </div>;
});

export function ControlledEvidenceProjectionForm({ runId, units, sources }: {
  runId: string;
  units: UnitOption[];
  sources: SourceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [unitRefs, setUnitRefs] = useState<Record<string, string[]>>({});
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [observed, setObserved] = useState<Record<string, string>>({});
  const [directions, setDirections] = useState<Record<string, "support" | "weaken" | "neutral">>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    const bindings = sources.filter((source) => selected[source.id]).map((source) => ({
      source_id: source.id,
      judgment_unit_ids: unitRefs[source.id] || [],
      subject_ref: (subjects[source.id] || "").trim(),
      observed_at: observed[source.id] ? new Date(`${observed[source.id]}T23:59:59`).toISOString() : "",
      direction: directions[source.id] || "support",
    }));
    if (!bindings.length || bindings.some((item) => !item.judgment_unit_ids.length || !item.subject_ref || !item.observed_at)) {
      setMessage("每个选中来源都必须挂到至少一个判断单元，并填写事实对象和观测日期。");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/runs/${runId}/stages/03/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "controlled_evidence_projection", bindings }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || "生成事实草稿失败");
      return;
    }
    setMessage("事实草稿已创建；来源原文未被改写。请逐条审阅后再确认证据。");
    router.refresh();
  }

  return <section className="card source-acquisition">
    <div className="panel-title"><div><span>模型取证失败时的手动路径</span><strong>把已核验来源登记为事实草稿</strong></div><button type="button" className="button-secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "建立事实草稿"}</button></div>
    <p className="muted">这里只允许选择已抓取、已核验逐字引文的来源；系统会复核发布日期、内容指纹和截止时间。候选不会直接变成已确认事实，生成后仍须逐条人工批准。</p>
    {open ? <div>
      {!sources.length ? <div className="notice">当前没有「可用 + 已抓取正文 + 引文已核验」的来源。请先在上方取得并核验公开来源。</div> : sources.map((source) => <div className="card" key={source.id} style={{ marginTop: 12 }}>
        <label><input type="checkbox" checked={Boolean(selected[source.id])} onChange={(event) => setSelected({ ...selected, [source.id]: event.target.checked })} /> 选择：{source.title}</label>
        <p className="muted">{source.publisher || "未知发布者"} · {source.published_at || "发布日期未知"}</p>
        {selected[source.id] ? <div className="source-form-grid">
          <div className="field source-wide"><label>挂到判断单元（可多选）</label>{units.map((unit) => <label key={unit.id}><input type="checkbox" checked={(unitRefs[source.id] || []).includes(unit.id)} onChange={(event) => {
            const current = unitRefs[source.id] || [];
            const next = event.target.checked ? [...new Set([...current, unit.id])] : current.filter((id) => id !== unit.id);
            setUnitRefs({ ...unitRefs, [source.id]: next });
          }} /> {unit.id} · {unit.title}</label>)}</div>
          <div className="field"><label>事实对象（口径标识）</label><input value={subjects[source.id] || ""} onChange={(event) => setSubjects({ ...subjects, [source.id]: event.target.value })} placeholder="例如：台积电营收" /></div>
          <div className="field"><label>事实观测日期</label><input type="date" value={observed[source.id] || ""} onChange={(event) => setObserved({ ...observed, [source.id]: event.target.value })} /></div>
          <div className="field"><label>相对待检验命题的证据方向</label><select value={directions[source.id] || "support"} onChange={(event) => setDirections({ ...directions, [source.id]: event.target.value as "support" | "weaken" | "neutral" })}><option value="support">支持</option><option value="weaken">削弱 / 反证</option><option value="neutral">背景 / 中性</option></select></div>
        </div> : null}
      </div>)}
      {message ? <div className="notice">{message}</div> : null}
      <button type="button" className="button" disabled={busy || !sources.length} onClick={submit}>{busy ? "正在按规则校验…" : "生成待审阅事实草稿"}</button>
    </div> : null}
  </section>;
}

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
    const structureCandidate = structureCompetingExplanations.find((item) => item.judgment_unit_ids.includes(unit.id));
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
      conclusion: String(judgment?.conclusion || ""),
      rationale: String(judgment?.rationale || ""),
      conditions: (judgment?.conditions || []).join("\n"),
      trackingSignals: (judgment?.tracking_signals || []).join("\n"),
      evidenceRoles,
      uncertainties: (judgment?.uncertainties || []).join("\n"),
      invalidations: (judgment?.invalidation_conditions || []).join("\n"),
      competition: String(primaryCompetition?.statement || structureCandidate?.statement || ""),
      sourceExplanationId: String(primaryCompetition?.source_explanation_id || structureCandidate?.explanation_id || ""),
      discriminators: (primaryCompetition?.discriminating_evidence || []).join("\n"),
      resolution,
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
      map.set(unit.id, structureCompetingExplanations.filter((item) => item.judgment_unit_ids.includes(unit.id)));
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
      <div><span>模型裁决失败时的手动路径</span><strong>基于已批准事实形成有边界的判断</strong></div>
      <button type="button" className="button-secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "形成判断草稿"}</button>
    </div>
    {open ? formBody : null}
  </>;
}

function JudgmentUnitHeader({ unit, badge }: { unit: UnitOption; badge?: { strength?: string; decisionStatus?: string } }) {
  return <div className="panel-title" style={{ marginBottom: 8 }}>
    <strong>{unit.id} · {unit.title}</strong>
    {badge?.strength ? <span className="workspace-status">{badge.strength}{badge.decisionStatus ? ` / ${badge.decisionStatus}` : ""}</span> : null}
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
    <strong>{application.method_id} · {application.capability_type}</strong>
    {application.precondition_checks.length ? application.precondition_checks.map((check) => {
      const automaticallyConfirmed = ["judgment_unit", "object_scope", "controlled_source_verification"].includes(check.precondition_id);
      const checked = automaticallyConfirmed || (confirmedPreconditions[unitId] || []).includes(check.precondition_id);
      return <label key={`${application.application_id}:${check.precondition_id}`}><input type="checkbox" disabled={locked || automaticallyConfirmed} checked={checked} onChange={(event) => {
        const current = confirmedPreconditions[unitId] || [];
        const next = event.target.checked ? [...new Set([...current, check.precondition_id])] : current.filter((id) => id !== check.precondition_id);
        setConfirmedPreconditions({ ...confirmedPreconditions, [unitId]: next });
      }} /> {check.reason || check.precondition_id}{automaticallyConfirmed ? "（已由已确认结构/来源自动满足）" : ""}</label>;
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
    <p className="muted">结论与推理要点由研究者填写；竞争解释优先来自 Stage02 候选。系统只使用已批准事实，并按规则重算强度上限、方法执行与语义校验。</p>
    {units.map((unit) => {
      const candidates = candidatesByUnit.get(unit.id) || [];
      const badge = statusBadges[unit.id];
      return <div className="card" key={unit.id} style={{ marginTop: 12 }}>
        <JudgmentUnitHeader unit={unit} badge={badge} />
        <div className="field"><label>方向结论</label><textarea disabled={locked} value={conclusions[unit.id] || ""} onChange={(event) => setConclusions({ ...conclusions, [unit.id]: event.target.value })} /></div>
        <div className="field"><label>推理要点</label><textarea disabled={locked} value={rationales[unit.id] || ""} onChange={(event) => setRationales({ ...rationales, [unit.id]: event.target.value })} placeholder="说明为何由这些事实得到该结论；强度仍由系统重算" /></div>
        <div className="field"><label>使用的已批准事实及其相对结论角色</label>{(evidenceByUnit.get(unit.id) || []).map((item) => <div className="evidence-role-row" key={item.id}><select disabled={locked} value={evidenceRoles[unit.id]?.[item.id] || "none"} onChange={(event) => setEvidenceRoles({ ...evidenceRoles, [unit.id]: { ...(evidenceRoles[unit.id] || {}), [item.id]: event.target.value as "none" | "support" | "counter" } })}><option value="none">不使用</option><option value="support">支持结论</option><option value="counter">反证 / 限制结论</option></select><span>{item.id} · {item.statement}{item.direction ? `（证据阶段：${({ support: "支持", weaken: "削弱", neutral: "中性" } as Record<string, string>)[item.direction] || item.direction}）` : ""}</span></div>)}</div>
        <div className="field"><label>方法适用条件（只勾选你能由当前结构和已批准事实确认的条件）</label>
          {methodApplications.filter((application) => application.target_judgment_unit_refs.includes(unit.id)).map((application) => <JudgmentMethodCard key={application.application_id} application={application} unitId={unit.id} confirmedPreconditions={confirmedPreconditions} setConfirmedPreconditions={setConfirmedPreconditions} locked={locked} />)}
          {!methodApplications.some((application) => application.target_judgment_unit_refs.includes(unit.id)) ? <div className="notice">该判断单元还没有登记可用的取证/裁决方法，不能形成可交付判断。</div> : null}
        </div>
        <div className="source-form-grid">
          <div className="field"><label>不确定性（每行一条）</label><textarea disabled={locked} value={uncertainties[unit.id] || ""} onChange={(event) => setUncertainties({ ...uncertainties, [unit.id]: event.target.value })} /></div>
          <div className="field"><label>改判条件（每行一条）</label><textarea disabled={locked} value={invalidations[unit.id] || ""} onChange={(event) => setInvalidations({ ...invalidations, [unit.id]: event.target.value })} /></div>
          <div className="field">
            <label>竞争解释{candidates.length ? "（来自 Stage02 候选）" : ""}</label>
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
                {candidates.map((item) => <option key={item.explanation_id} value={item.explanation_id}>{item.explanation_id} · {item.statement}</option>)}
              </select>
            ) : <p className="muted">Stage02 未挂接本单元的竞争解释；请手写一条，并建议回到结构页补绑定。</p>}
            <textarea disabled={locked} value={competitions[unit.id] || ""} onChange={(event) => setCompetitions({ ...competitions, [unit.id]: event.target.value })} />
          </div>
          <div className="field"><label>区分性证据（每行一条）</label><textarea disabled={locked} value={discriminators[unit.id] || ""} onChange={(event) => setDiscriminators({ ...discriminators, [unit.id]: event.target.value })} /></div><div className="field"><label>适用边界补充（每行一条，可选）</label><textarea disabled={locked} value={conditionsText[unit.id] || ""} onChange={(event) => setConditionsText({ ...conditionsText, [unit.id]: event.target.value })} /></div>
          <div className="field"><label>跟踪信号（每行一条，可选）</label><textarea disabled={locked} value={trackingSignals[unit.id] || ""} onChange={(event) => setTrackingSignals({ ...trackingSignals, [unit.id]: event.target.value })} placeholder="下一步要盯什么指标或事件" /></div>
        </div>
        <div className="field"><label>反证如何被解决（可留空；若支持与反证并存且留空，系统将结论标为「暂不可判断 / 存在争议」）</label><textarea disabled={locked} value={resolutions[unit.id] || ""} onChange={(event) => setResolutions({ ...resolutions, [unit.id]: event.target.value })} /></div>
      </div>;
    })}
    {message ? <div className="notice">{message}</div> : null}
    {variant === "fallback" ? <button type="button" className="button" disabled={busy || locked || !units.length || !evidence.length} onClick={() => void onSubmit()}>{busy ? "正在执行规则与方法…" : "生成待审阅判断草稿"}</button> : null}
  </div>;
}
