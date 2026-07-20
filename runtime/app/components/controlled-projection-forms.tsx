"use client";

import { useMemo, useState } from "react";
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

type StructureUnitDraft = { title: string; question: string; judgment_type: string; evidence_requirements: string };

export function ControlledScopeProjectionForm({ runId, question, existingJson, enabled }: { runId: string; question: string; existingJson?: string; enabled: boolean }) {
  const router = useRouter();
  let existing: any = {};
  try { existing = JSON.parse(existingJson || "{}"); } catch { existing = {}; }
  const [open, setOpen] = useState(false);
  const [normalizedQuestion, setNormalizedQuestion] = useState(String(existing.normalized_question || question));
  const [coreObject, setCoreObject] = useState(String(existing.core_object || ""));
  const [judgmentAction, setJudgmentAction] = useState(String(existing.judgment_action || ""));
  const [lookback, setLookback] = useState(String(existing.time_scope?.lookback || ""));
  const [asOf, setAsOf] = useState(String(existing.time_scope?.as_of || ""));
  const [forward, setForward] = useState(String(existing.time_scope?.forward || ""));
  const [boundaries, setBoundaries] = useState((existing.boundaries || []).join("\n"));
  const [exclusions, setExclusions] = useState((existing.exclusions || []).join("\n"));
  const [reportType, setReportType] = useState(String(existing.report_type || "可审计研究判断简报"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    const scope = {
      normalized_question: normalizedQuestion.trim(), core_object: coreObject.trim(), judgment_action: judgmentAction.trim(),
      lookback: lookback.trim(), as_of: asOf.trim(), forward: forward.trim(), boundaries: lines(boundaries), exclusions: lines(exclusions), report_type: reportType.trim(),
    };
    if (!scope.normalized_question || !scope.core_object || !scope.judgment_action || !scope.lookback || !scope.as_of || !scope.forward || scope.boundaries.length < 2 || !scope.exclusions.length || !scope.report_type) {
      setMessage("规范化问题、核心对象、判断动作、时间范围和交付类型必须填写；至少两条边界和一条排除项。");
      return;
    }
    setBusy(true); setMessage("");
    const response = await fetch(`/api/runs/${runId}/stages/01/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "deterministic_projection", scope }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error || "受控范围创建失败"); return; }
    setMessage("受控范围已创建；本阶段没有登记事实或方向判断，请审阅后确认。");
    router.refresh();
  }

  return <section className="card source-acquisition">
    <div className="panel-title"><div><span>不用模型的受控范围</span><strong>显式冻结对象、动作、时间和排除项</strong></div><button type="button" className="button-secondary" disabled={!enabled} onClick={() => setOpen((value) => !value)}>{open ? "收起" : existingJson ? "重建受控范围" : "建立受控范围"}</button></div>
    <p className="muted">空白运行不接受“研究问题指向的对象”之类泛化占位语。这里只定义研究任务，不得填写未经来源核验的事实或结论。</p>
    {open ? <div className="source-form-grid">
      <div className="field source-wide"><label>规范化研究问题</label><textarea value={normalizedQuestion} onChange={(event) => setNormalizedQuestion(event.target.value)} /></div>
      <div className="field"><label>核心对象与口径</label><textarea value={coreObject} onChange={(event) => setCoreObject(event.target.value)} /></div>
      <div className="field"><label>要完成的判断动作</label><textarea value={judgmentAction} onChange={(event) => setJudgmentAction(event.target.value)} /></div>
      <div className="field"><label>回看期</label><input value={lookback} onChange={(event) => setLookback(event.target.value)} /></div>
      <div className="field"><label>截止时点（日/月/季度/半年）</label><input value={asOf} onChange={(event) => setAsOf(event.target.value)} placeholder="例如：2025年上半年" /></div>
      <div className="field"><label>前瞻期</label><input value={forward} onChange={(event) => setForward(event.target.value)} /></div>
      <div className="field"><label>交付类型</label><input value={reportType} onChange={(event) => setReportType(event.target.value)} /></div>
      <div className="field"><label>研究边界（每行一条，至少两条）</label><textarea value={boundaries} onChange={(event) => setBoundaries(event.target.value)} /></div>
      <div className="field"><label>排除项（每行一条）</label><textarea value={exclusions} onChange={(event) => setExclusions(event.target.value)} /></div>
      <div className="field source-wide">{message ? <div className="notice">{message}</div> : null}<button type="button" className="button" disabled={busy} onClick={submit}>{busy ? "正在冻结范围…" : "生成待审阅 Stage01"}</button></div>
    </div> : null}
  </section>;
}

export function ControlledStructureProjectionForm({ runId, enabled }: { runId: string; enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("");
  const [units, setUnits] = useState<StructureUnitDraft[]>([{ title: "", question: "", judgment_type: "cycle_phase", evidence_requirements: "" }]);
  const [counterDirections, setCounterDirections] = useState("");
  const [competitions, setCompetitions] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    const structure = {
      scope_label: scope.trim(),
      units: units.map((unit, index) => ({
        id: `JU-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
        title: unit.title.trim(),
        question: unit.question.trim(),
        judgment_type: unit.judgment_type,
        evidence_requirements: lines(unit.evidence_requirements),
      })),
      counter_evidence_directions: lines(counterDirections),
      competing_explanations: lines(competitions),
    };
    if (!structure.scope_label || structure.units.some((unit) => !unit.title || !unit.question || !unit.evidence_requirements.length) || !structure.counter_evidence_directions.length || !structure.competing_explanations.length) {
      setMessage("范围、每个原子判断、必要证据、反向证据方向和竞争解释都必须填写。");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/runs/${runId}/stages/02/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "controlled_structure_projection", structure }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || "受控研究结构创建失败");
      return;
    }
    setMessage("研究结构已创建；每个判断单元均已登记结构、取证和裁决方法，但尚未宣称执行。请审阅后确认 Stage02。");
    router.refresh();
  }

  return <section className="card source-acquisition">
    <div className="panel-title"><div><span>模型不可用时的受控路径</span><strong>由研究者拆解原子判断与竞争解释</strong></div><button type="button" className="button-secondary" disabled={!enabled} onClick={() => setOpen((value) => !value)}>{open ? "收起" : "建立研究结构"}</button></div>
    <p className="muted">Runtime 会为每个判断类型绑定登记过的默认结构、取证和裁决方法；任务特有变量只标记为 task_local，不会为了凑形式扩充本体。</p>
    {open ? <div>
      <div className="field"><label>研究范围</label><textarea value={scope} onChange={(event) => setScope(event.target.value)} /></div>
      {units.map((unit, index) => <div className="card" key={index} style={{ marginTop: 12 }}>
        <div className="panel-title"><span>JudgmentUnit {String(index + 1).padStart(2, "0")}</span>{units.length > 1 ? <button className="button-quiet" type="button" onClick={() => setUnits(units.filter((_, itemIndex) => itemIndex !== index))}>删除</button> : null}</div>
        <div className="source-form-grid"><div className="field"><label>标题</label><input value={unit.title} onChange={(event) => setUnits(units.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></div><div className="field"><label>判断类型</label><select value={unit.judgment_type} onChange={(event) => setUnits(units.map((item, itemIndex) => itemIndex === index ? { ...item, judgment_type: event.target.value } : item))}><option value="state_measurement">状态测量</option><option value="trend_direction">趋势方向</option><option value="cycle_phase">周期阶段</option><option value="mechanism_validation">机制验证</option><option value="causal_attribution">原因归因</option><option value="transmission_path">传导路径</option><option value="object_differentiation">对象分化</option><option value="impact_realization">影响兑现</option><option value="expectation_gap">预期差</option><option value="valuation_impact">估值影响</option></select></div><div className="field source-wide"><label>原子判断问题</label><textarea value={unit.question} onChange={(event) => setUnits(units.map((item, itemIndex) => itemIndex === index ? { ...item, question: event.target.value } : item))} /></div><div className="field source-wide"><label>必要证据（每行一条）</label><textarea value={unit.evidence_requirements} onChange={(event) => setUnits(units.map((item, itemIndex) => itemIndex === index ? { ...item, evidence_requirements: event.target.value } : item))} /></div></div>
      </div>)}
      <button className="button-secondary" type="button" onClick={() => setUnits([...units, { title: "", question: "", judgment_type: "cycle_phase", evidence_requirements: "" }])}>＋ 添加判断单元</button>
      <div className="source-form-grid"><div className="field"><label>必须主动寻找的反向证据（每行一条）</label><textarea value={counterDirections} onChange={(event) => setCounterDirections(event.target.value)} /></div><div className="field"><label>竞争解释（每行一条）</label><textarea value={competitions} onChange={(event) => setCompetitions(event.target.value)} /></div></div>
      {message ? <div className="notice">{message}</div> : null}
      <button type="button" className="button" disabled={busy} onClick={submit}>{busy ? "正在校验方法路由…" : "生成待审阅研究结构"}</button>
    </div> : null}
  </section>;
}

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
      setMessage("每个选中来源都必须绑定至少一个判断单元，并填写事实对象和观测日期。");
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
      setMessage(result.error || "受控事实投影失败");
      return;
    }
    setMessage("事实草稿已创建；来源原文未被改写。请逐条审阅工作项后再批准 Stage03。");
    router.refresh();
  }

  return <section className="card source-acquisition">
    <div className="panel-title"><div><span>模型取证失败时的受控路径</span><strong>把已核验来源登记为事实草稿</strong></div><button type="button" className="button-secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "建立事实草稿"}</button></div>
    <p className="muted">这里只允许选择已抓取、已核验逐字引文的来源；系统重查发布日期、内容哈希和截止时间。候选不会直接成为 EvidenceFact，生成后仍须逐条人工批准。</p>
    {open ? <div>
      {!sources.length ? <div className="notice">当前没有满足 usable / captured / quote_verified 的来源。请先在上方取得并核验公开来源。</div> : sources.map((source) => <div className="card" key={source.id} style={{ marginTop: 12 }}>
        <label><input type="checkbox" checked={Boolean(selected[source.id])} onChange={(event) => setSelected({ ...selected, [source.id]: event.target.checked })} /> 选择：{source.title}</label>
        <p className="muted">{source.publisher || "未知发布者"} · {source.published_at || "发布日期未知"}</p>
        {selected[source.id] ? <div className="source-form-grid">
          <div className="field source-wide"><label>绑定判断单元（可多选）</label>{units.map((unit) => <label key={unit.id}><input type="checkbox" checked={(unitRefs[source.id] || []).includes(unit.id)} onChange={(event) => {
            const current = unitRefs[source.id] || [];
            const next = event.target.checked ? [...new Set([...current, unit.id])] : current.filter((id) => id !== unit.id);
            setUnitRefs({ ...unitRefs, [source.id]: next });
          }} /> {unit.id} · {unit.title}</label>)}</div>
          <div className="field"><label>事实对象 / subject_ref</label><input value={subjects[source.id] || ""} onChange={(event) => setSubjects({ ...subjects, [source.id]: event.target.value })} placeholder="例如：tsmc_revenue" /></div>
          <div className="field"><label>事实观测日期</label><input type="date" value={observed[source.id] || ""} onChange={(event) => setObserved({ ...observed, [source.id]: event.target.value })} /></div>
          <div className="field"><label>相对待检验命题的证据方向</label><select value={directions[source.id] || "support"} onChange={(event) => setDirections({ ...directions, [source.id]: event.target.value as "support" | "weaken" | "neutral" })}><option value="support">支持</option><option value="weaken">削弱 / 反证</option><option value="neutral">背景 / 中性</option></select></div>
        </div> : null}
      </div>)}
      {message ? <div className="notice">{message}</div> : null}
      <button type="button" className="button" disabled={busy || !sources.length} onClick={submit}>{busy ? "正在执行确定性校验…" : "生成待审阅事实草稿"}</button>
    </div> : null}
  </section>;
}

export function ControlledJudgmentProjectionForm({ runId, units, evidence, methodApplications }: {
  runId: string;
  units: UnitOption[];
  evidence: EvidenceOption[];
  methodApplications: MethodApplicationOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [conclusions, setConclusions] = useState<Record<string, string>>({});
  const [evidenceRoles, setEvidenceRoles] = useState<Record<string, Record<string, "none" | "support" | "counter">>>({});
  const [uncertainties, setUncertainties] = useState<Record<string, string>>({});
  const [invalidations, setInvalidations] = useState<Record<string, string>>({});
  const [competitions, setCompetitions] = useState<Record<string, string>>({});
  const [discriminators, setDiscriminators] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [confirmedPreconditions, setConfirmedPreconditions] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const evidenceByUnit = useMemo(() => new Map(units.map((unit) => [unit.id, evidence.filter((item) => item.judgment_unit_ids.includes(unit.id))])), [units, evidence]);

  async function submit() {
    const judgments = units.map((unit) => ({
      judgment_unit_id: unit.id,
      conclusion: (conclusions[unit.id] || "").trim(),
      supporting_evidence_draft_ids: Object.entries(evidenceRoles[unit.id] || {}).filter(([, role]) => role === "support").map(([id]) => id),
      counter_evidence_draft_ids: Object.entries(evidenceRoles[unit.id] || {}).filter(([, role]) => role === "counter").map(([id]) => id),
      uncertainties: lines(uncertainties[unit.id] || ""),
      invalidation_conditions: lines(invalidations[unit.id] || ""),
      competing_explanation: (competitions[unit.id] || "").trim(),
      discriminating_evidence: lines(discriminators[unit.id] || ""),
      counterevidence_resolution: (resolutions[unit.id] || "").trim(),
      confirmed_precondition_ids: confirmedPreconditions[unit.id] || [],
    }));
    if (!judgments.length || judgments.some((item) => !item.conclusion || !(item.supporting_evidence_draft_ids.length + item.counter_evidence_draft_ids.length) || !item.uncertainties.length || !item.invalidation_conditions.length || !item.competing_explanation || !item.discriminating_evidence.length)) {
      setMessage("每个判断单元都必须填写结论、事实角色、不确定性、竞争解释、区分性证据和改判条件。");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/runs/${runId}/stages/04/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "controlled_judgment_projection", judgments }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || "受控判断投影失败");
      return;
    }
    setMessage("判断草稿已创建；证据上限、方法执行、竞争解释和五项 Runtime 规则已重新计算。请逐条审阅后再批准 Stage04。");
    router.refresh();
  }

  return <section className="card source-acquisition" style={{ marginBottom: 16 }}>
    <div className="panel-title"><div><span>模型裁决失败时的受控路径</span><strong>基于已批准事实形成有边界的判断</strong></div><button type="button" className="button-secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "形成判断草稿"}</button></div>
    <p className="muted">结论由研究者明确填写；系统只允许绑定该判断单元的已批准事实，并确定性执行方法前置条件、J0–J4 证据上限与推理链完整性校验。</p>
    {open ? <div>{units.map((unit) => <div className="card" key={unit.id} style={{ marginTop: 12 }}>
      <strong>{unit.id} · {unit.title}</strong>
      <div className="field"><label>方向结论</label><textarea value={conclusions[unit.id] || ""} onChange={(event) => setConclusions({ ...conclusions, [unit.id]: event.target.value })} /></div>
      <div className="field"><label>使用的已批准事实及其相对结论角色</label>{(evidenceByUnit.get(unit.id) || []).map((item) => <div className="evidence-role-row" key={item.id}><select value={evidenceRoles[unit.id]?.[item.id] || "none"} onChange={(event) => setEvidenceRoles({ ...evidenceRoles, [unit.id]: { ...(evidenceRoles[unit.id] || {}), [item.id]: event.target.value as "none" | "support" | "counter" } })}><option value="none">不使用</option><option value="support">支持结论</option><option value="counter">反证 / 限制结论</option></select><span>{item.id} · {item.statement}{item.direction ? `（Stage03：${item.direction}）` : ""}</span></div>)}</div>
      <div className="field"><label>方法适用条件（只勾选你能由当前结构和已批准事实确认的条件）</label>
        {methodApplications.filter((application) => application.target_judgment_unit_refs.includes(unit.id)).map((application) => <div className="card" key={application.application_id} style={{ marginTop: 8 }}>
          <strong>{application.method_id} · {application.capability_type}</strong>
          {application.precondition_checks.length ? application.precondition_checks.map((check) => {
            const automaticallyConfirmed = ["judgment_unit", "object_scope", "controlled_source_verification"].includes(check.precondition_id);
            const checked = automaticallyConfirmed || (confirmedPreconditions[unit.id] || []).includes(check.precondition_id);
            return <label key={`${application.application_id}:${check.precondition_id}`}><input type="checkbox" disabled={automaticallyConfirmed} checked={checked} onChange={(event) => {
              const current = confirmedPreconditions[unit.id] || [];
              const next = event.target.checked ? [...new Set([...current, check.precondition_id])] : current.filter((id) => id !== check.precondition_id);
              setConfirmedPreconditions({ ...confirmedPreconditions, [unit.id]: next });
            }} /> {check.precondition_id}{automaticallyConfirmed ? "（由已批准结构/来源合同确认）" : ""}</label>;
          }) : <p className="muted">该方法没有登记额外前置条件。</p>}
        </div>)}
        {!methodApplications.some((application) => application.target_judgment_unit_refs.includes(unit.id)) ? <div className="notice">该判断单元没有已登记 MethodApplication，不能形成可交付判断。</div> : null}
      </div>
      <div className="source-form-grid"><div className="field"><label>不确定性（每行一条）</label><textarea value={uncertainties[unit.id] || ""} onChange={(event) => setUncertainties({ ...uncertainties, [unit.id]: event.target.value })} /></div><div className="field"><label>改判条件（每行一条）</label><textarea value={invalidations[unit.id] || ""} onChange={(event) => setInvalidations({ ...invalidations, [unit.id]: event.target.value })} /></div><div className="field"><label>竞争解释</label><textarea value={competitions[unit.id] || ""} onChange={(event) => setCompetitions({ ...competitions, [unit.id]: event.target.value })} /></div><div className="field"><label>区分性证据（每行一条）</label><textarea value={discriminators[unit.id] || ""} onChange={(event) => setDiscriminators({ ...discriminators, [unit.id]: event.target.value })} /></div></div>
      <div className="field"><label>反证如何被解决（可留空；若支持与反证并存且留空，系统强制 J0/contested）</label><textarea value={resolutions[unit.id] || ""} onChange={(event) => setResolutions({ ...resolutions, [unit.id]: event.target.value })} /></div>
    </div>)}
      {message ? <div className="notice">{message}</div> : null}
      <button type="button" className="button" disabled={busy || !units.length || !evidence.length} onClick={submit}>{busy ? "正在执行规则与方法…" : "生成待审阅判断草稿"}</button>
    </div> : null}
  </section>;
}
