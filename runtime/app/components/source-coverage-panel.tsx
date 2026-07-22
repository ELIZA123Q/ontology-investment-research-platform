"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveSourceResearchLifecycle, type SourceCoverageSummary, type SourceFactStatus } from "@/engine/source_coverage";
import type { SourceRecord } from "@/engine/types";
import { authorityTypeLabel, retrievalLabel, usabilityLabel } from "@/app/lib/ui-labels";

type UnitOption = { id: string; title: string };
type SourceRow = Pick<SourceRecord, "id" | "title" | "publisher" | "published_at" | "url" | "locator" | "usability_status" | "retrieval_status" | "authority_type" | "source_tier" | "quote_verified" | "failure_detail"> & { fact_status: SourceFactStatus };

const ACQUIRE_AUTHORITY_OPTIONS = [
  ["official", "监管 / 官方原文"],
  ["company_disclosure", "公司披露"],
  ["industry_provider", "行业数据 / 协会统计"],
  ["public_secondary", "公开二手（媒体/网页等）"],
] as const;

export function SourceCoveragePanel({
  runId,
  units,
  sources,
  controlledSources,
  coverage,
  boundSourceIds,
}: {
  runId: string;
  units: UnitOption[];
  sources: SourceRow[];
  controlledSources: Array<{ id: string; title: string; publisher: string; published_at: string | null; authority_type?: string }>;
  coverage: SourceCoverageSummary;
  boundSourceIds: string[];
}) {
  const router = useRouter();
  const boundSourceIdSet = useMemo(() => new Set(boundSourceIds), [boundSourceIds]);
  const [acquireOpen, setAcquireOpen] = useState(coverage.missing_core_types.length > 0);
  const [projectionOpen, setProjectionOpen] = useState(false);
  const [acquireBusy, setAcquireBusy] = useState(false);
  const [acquireMessage, setAcquireMessage] = useState("");
  const [defaultAuthority, setDefaultAuthority] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [unitRefs, setUnitRefs] = useState<Record<string, string[]>>({});
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [observed, setObserved] = useState<Record<string, string>>({});
  const [directions, setDirections] = useState<Record<string, "support" | "weaken" | "neutral">>({});
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [projectionMessage, setProjectionMessage] = useState("");

  useEffect(() => {
    if (coverage.missing_core_types[0]) setDefaultAuthority(coverage.missing_core_types[0]);
  }, [coverage.missing_core_types]);

  const unboundCandidates = useMemo(
    () => sources.filter((source) => !boundSourceIdSet.has(source.id)),
    [sources, boundSourceIdSet],
  );
  const unitTitleById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.title])), [units]);

  function counterStatusLabel(status: SourceCoverageSummary["unit_coverage"][number]["counter_check_status"]) {
    if (status === "observed") return "已有反证 / 削弱事实";
    if (status === "gap") return "反证缺口已登记";
    if (status === "not_recorded") return "反证尚未登记";
    return "本单元未要求反证";
  }

  function preselectSource(sourceId: string) {
    setSelected({ [sourceId]: true });
    setProjectionOpen(true);
    const row = document.getElementById("source-projection");
    row?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function acquireSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAcquireBusy(true);
    setAcquireMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/runs/${runId}/sources/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const result = await response.json();
    setAcquireBusy(false);
    if (!response.ok) {
      setAcquireMessage(result.error || result.source?.failure_detail || "来源未通过抓取与引用定位校验");
      router.refresh();
      return;
    }
    setAcquireMessage("来源已核验并进入候选池。请在下方挂到判断单元并生成待审事实草稿。");
    setProjectionOpen(true);
    router.refresh();
  }

  async function submitProjection() {
    const bindings = controlledSources.filter((source) => selected[source.id]).map((source) => ({
      source_id: source.id,
      judgment_unit_ids: unitRefs[source.id] || [],
      subject_ref: (subjects[source.id] || "").trim(),
      observed_at: observed[source.id] ? new Date(`${observed[source.id]}T23:59:59`).toISOString() : "",
      direction: directions[source.id] || "support",
    }));
    if (!bindings.length || bindings.some((item) => !item.judgment_unit_ids.length || !item.subject_ref || !item.observed_at)) {
      setProjectionMessage("每个选中来源都必须挂到至少一个判断单元，并填写事实对象和观测日期。");
      return;
    }
    setProjectionBusy(true);
    setProjectionMessage("");
    const response = await fetch(`/api/runs/${runId}/stages/03/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "controlled_evidence_projection", bindings }),
    });
    const result = await response.json();
    setProjectionBusy(false);
    if (!response.ok) {
      setProjectionMessage(result.error || "生成事实草稿失败");
      return;
    }
    setProjectionMessage("事实草稿已创建；请到证据审阅页逐条或批量确认。");
    setSelected({});
    router.refresh();
  }

  return <section className="card source-coverage-panel">
    <div className="panel-title">
      <div>
        <span>来源覆盖与补充</span>
        <strong>先看缺什么来源，再补充并挂到判断单元</strong>
      </div>
      <div className="coverage-meta">
        <span>覆盖缺口 {coverage.coverage_gap_count}</span>
        <span>覆盖率 {(coverage.coverage_rate * 100).toFixed(0)}%</span>
        <span>核验率 {(coverage.verification_rate * 100).toFixed(0)}%</span>
        <span>公开二手 {coverage.public_secondary_count}</span>
      </div>
    </div>
    <p className="muted">核验成功的来源只是候选输入，不会直接变成已确认事实；生成事实草稿后仍须审阅确认。自动补证在覆盖率≥70%且核验率≥50%，或缺口清零时停止（默认最多 3 轮）。</p>

    <div className="authority-coverage-grid">
      {coverage.authority_coverage.map((cell) => (
        <div className={`authority-coverage-cell ${cell.present ? "present" : "missing"}`} key={cell.authority_type}>
          <span className="authority-type">{cell.label}</span>
          <strong>{cell.present ? `已有 ${cell.usable_count}` : "缺失"}</strong>
          <small>{cell.bound_count ? `已挂判断 ${cell.bound_count}` : "尚未挂到判断"}</small>
        </div>
      ))}
    </div>

    {coverage.unit_coverage.length ? <div className="unit-coverage-grid">
      {coverage.unit_coverage.map((unit) => (
        <div className={`unit-coverage-card ${unit.has_support_evidence && unit.meets_independence ? "ok" : "warn"}`} key={unit.unit_id}>
          <header>
            <strong>{unitTitleById.get(unit.unit_id) || "未命名判断"}</strong>
            <span className={`judgment-ceiling ${unit.evidence_ceiling === "J0" ? "blocked" : ""}`}>证据侧上限 {unit.evidence_ceiling}</span>
          </header>
          <div className="unit-coverage-metrics">
            <span>可核验事实 {unit.usable_fact_count}</span>
            <span>支持 {unit.support_draft_count}</span>
            <span>反证 {unit.counter_draft_count}</span>
            <span>独立来源组 {unit.independent_source_groups}/{unit.minimum_independent_sources}</span>
          </div>
          <p><b>当前最薄弱环节：</b>{unit.weakest_link}</p>
          <p><b>反证检查：</b>{counterStatusLabel(unit.counter_check_status)}</p>
          {unit.requirements.length ? <details>
            <summary>最低证据组合（{unit.requirements.length} 项）</summary>
            <ul>{unit.requirements.map((requirement) => <li key={requirement.id}>
              {requirement.requirement}
              <small>{requirement.evidence_role === "counter" ? "反证" : requirement.evidence_role === "support" ? "支持" : "边界/背景"} · 独立来源至少 {requirement.minimum_independent_sources}</small>
            </li>)}</ul>
          </details> : <p className="muted">结构阶段尚未登记最低证据组合。</p>}
        </div>
      ))}
    </div> : null}

    {sources.length ? <div className="source-inventory">
      <header><strong>已登记来源</strong><span>{sources.length} 条</span></header>
      <ul className="source-list">
        {sources.map((source) => {
          const bound = boundSourceIdSet.has(source.id);
          const controllable = controlledSources.some((item) => item.id === source.id);
          const lifecycle = deriveSourceResearchLifecycle({
            retrievalStatus: source.retrieval_status,
            quoteVerified: Boolean(source.quote_verified),
            factStatus: source.fact_status,
          });
          return <li key={source.id}>
            <div className="source-row-head">
              <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
              <span className={`source-research-state state-${lifecycle.stage}`}>{lifecycle.label}</span>
            </div>
            <small className="source-provenance-line">
              {authorityTypeLabel(source.authority_type || "unknown")} · 等级 {source.source_tier || "S8"} · {source.publisher || "未知发布者"} · {source.published_at || "发布日期未知"}
              · {usabilityLabel(source.usability_status || "candidate")} / {retrievalLabel(source.retrieval_status || "not_attempted")}
            </small>
            <div className="source-lifecycle" aria-label={`来源研究状态：${lifecycle.label}`}>
              <span className="done"><i>1</i>线索</span>
              <span className={lifecycle.bodyCaptured ? "done" : ""}><i>2</i>正文</span>
              <span className={lifecycle.quoteVerified ? "done" : ""}><i>3</i>引文</span>
              <span className={lifecycle.evidenceFact ? "done" : lifecycle.factDraft ? "pending" : ""}>
                <i>4</i>{lifecycle.factDraft ? "事实待审" : "事实"}
              </span>
            </div>
            {source.failure_detail ? <small className="source-failure-detail">未能继续：{source.failure_detail}</small> : null}
            {controllable && !bound ? <button type="button" className="button-secondary button-compact" onClick={() => preselectSource(source.id)}>挂到判断单元</button> : null}
          </li>;
        })}
      </ul>
    </div> : null}

    {unboundCandidates.length ? <p className="muted">另有 {unboundCandidates.length} 条来源尚未挂到任何判断单元，可在下方生成事实草稿。</p> : null}

    <div className="coverage-actions">
      <button type="button" className="button-secondary" onClick={() => setAcquireOpen((value) => !value)}>
        {acquireOpen ? "收起补充来源" : coverage.missing_core_types.length ? `补充缺失来源（缺 ${coverage.missing_core_types.map(authorityTypeLabel).join("、")}）` : "补充来源"}
      </button>
      <button
        type="button"
        className="button-secondary"
        id="source-projection"
        disabled={!controlledSources.length && !projectionOpen}
        onClick={() => setProjectionOpen((value) => !value)}
      >
        {projectionOpen ? "收起事实草稿" : "从已核验来源生成事实草稿"}
      </button>
    </div>

    {acquireOpen ? <form className="source-acquire-form" onSubmit={acquireSource}>
      <div className="source-form-grid">
        <div className="field source-url"><label>公开 URL</label><input name="url" type="url" required /></div>
        <div className="field"><label>来源标题</label><input name="title" required /></div>
        <div className="field"><label>发布者</label><input name="publisher" required /></div>
        <div className="field"><label>发布日期</label><input name="published_at" type="date" required /></div>
        <div className="field source-wide"><label>页内定位</label><input name="locator" placeholder="段落标题、表格行或 quote:…" required /></div>
        <div className="field source-wide"><label>正文逐字引用</label><textarea name="source_quote" placeholder="必须能在抓取正文中逐字定位，至少 20 个字符" required /></div>
      </div>
      <details className="source-tech-details">
        <summary>高级来源字段</summary>
        <div className="source-form-grid">
          <div className="field"><label>来源权威类型</label>
            <select name="authority_type" defaultValue={defaultAuthority || "company_disclosure"} required>
              {ACQUIRE_AUTHORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field"><label>来源等级</label><select name="source_tier" defaultValue="S2">{["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"].map((tier) => <option key={tier}>{tier}</option>)}</select></div>
          <div className="field"><label>独立来源组（可选）</label><input name="source_group" placeholder="默认使用发布者" /></div>
        </div>
      </details>
      {acquireMessage ? <div className="notice">{acquireMessage}</div> : null}
      <button className="button" disabled={acquireBusy}>{acquireBusy ? "正在抓取并核验…" : "取得来源并进入候选池"}</button>
    </form> : null}

    {projectionOpen && controlledSources.length ? <div className="source-projection-block">
      {controlledSources.map((source) => <div className="card projection-card" key={source.id}>
        <label><input type="checkbox" checked={Boolean(selected[source.id])} onChange={(event) => setSelected({ ...selected, [source.id]: event.target.checked })} /> 选择：{source.title}</label>
        <p className="muted">{authorityTypeLabel(source.authority_type || "unknown")} · {source.publisher || "未知发布者"} · {source.published_at || "发布日期未知"}</p>
        {selected[source.id] ? <div className="source-form-grid">
          <div className="field source-wide"><label>挂到判断单元（可多选）</label>{units.map((unit) => <label key={unit.id}><input type="checkbox" checked={(unitRefs[source.id] || []).includes(unit.id)} onChange={(event) => {
            const current = unitRefs[source.id] || [];
            const next = event.target.checked ? [...new Set([...current, unit.id])] : current.filter((id) => id !== unit.id);
            setUnitRefs({ ...unitRefs, [source.id]: next });
          }} /> {unit.title}</label>)}</div>
          <div className="field"><label>事实对象（口径标识）</label><input value={subjects[source.id] || ""} onChange={(event) => setSubjects({ ...subjects, [source.id]: event.target.value })} placeholder="例如：HBM 合约价" /></div>
          <div className="field"><label>事实观测日期</label><input type="date" value={observed[source.id] || ""} onChange={(event) => setObserved({ ...observed, [source.id]: event.target.value })} /></div>
          <div className="field"><label>证据方向</label><select value={directions[source.id] || "support"} onChange={(event) => setDirections({ ...directions, [source.id]: event.target.value as "support" | "weaken" | "neutral" })}><option value="support">支持</option><option value="weaken">削弱 / 反证</option><option value="neutral">背景 / 中性</option></select></div>
        </div> : null}
      </div>)}
      {projectionMessage ? <div className="notice">{projectionMessage}</div> : null}
      <button type="button" className="button" disabled={projectionBusy} onClick={submitProjection}>{projectionBusy ? "正在按规则校验…" : "生成待审阅事实草稿"}</button>
    </div> : null}
  </section>;
}
