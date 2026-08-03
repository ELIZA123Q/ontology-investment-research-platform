"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deriveSourceResearchLifecycle, type SourceCoverageSummary, type SourceFactStatus } from "@/engine/source_coverage";
import type { SourceRecord } from "@/engine/types";
import { authorityTypeLabel, retrievalLabel, sourceTierLabel, usabilityLabel } from "@/app/lib/ui-labels";
import { judgmentStrengthLabel, researcherLanguage } from "@/app/lib/researcher-stage-output";
import { ONTOLOGY_SOURCE_TIERS } from "@/engine/ontology_vocabulary.generated";

type UnitOption = { id: string; title: string };
type SourceRow = Pick<SourceRecord, "id" | "title" | "publisher" | "published_at" | "url" | "locator" | "usability_status" | "retrieval_status" | "authority_type" | "source_tier" | "quote_verified" | "failure_detail" | "source_type"> & { fact_status: SourceFactStatus };

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
  const unitGapCount = coverage.coverage_gap_count;
  // 整 run 严格 1 条手动完整证据：仅统计“已核验通过”的人工来源（source_type 标记）。
  const manualCount = useMemo(
    () => sources.filter((source) => source.source_type === "user_supplied_public_evidence" && source.quote_verified).length,
    [sources],
  );
  const manualCapReached = manualCount >= 1;
  const [acquireOpen, setAcquireOpen] = useState(false);
  const [acquireBusy, setAcquireBusy] = useState(false);
  const [acquireMessage, setAcquireMessage] = useState("");
  const [manualTargetUnit, setManualTargetUnit] = useState("");
  const [manualDirection, setManualDirection] = useState<"support" | "weaken" | "neutral">("support");

  const unboundCandidates = useMemo(
    () => sources.filter((source) => !boundSourceIdSet.has(source.id)),
    [sources, boundSourceIdSet],
  );
  const unitTitleById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.title])), [units]);
  const draftCount = sources.filter((source) => source.fact_status === "draft").length;

  function counterStatusLabel(status: SourceCoverageSummary["unit_coverage"][number]["counter_check_status"]) {
    if (status === "observed") return "已有反证 / 削弱事实";
    if (status === "searched_gap") return "已完成反向检索，当前范围未取得可核验反证";
    if (status === "gap") return "反证暂缺已登记";
    if (status === "not_recorded") return "反证尚未登记";
    return "本单元未要求反证";
  }

  async function acquireSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAcquireBusy(true);
    setAcquireMessage("");
    const form = new FormData(event.currentTarget);
    const unitId = manualTargetUnit;
    if (!unitId) {
      setAcquireMessage("请先选择该证据支持的判断单元。");
      setAcquireBusy(false);
      return;
    }
    const response = await fetch(`/api/runs/${runId}/sources/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const result = await response.json();
    if (!response.ok || !result?.accepted) {
      setAcquireMessage(result?.error || result?.source?.failure_detail || "来源未通过抓取与引用定位校验（需 ≥20 字可定位逐字引文）");
      setAcquireBusy(false);
      router.refresh();
      return;
    }
    const sourceId = result?.source?.id;
    const unitTitle = units.find((unit) => unit.id === unitId)?.title || "";
    const publishedAt = String(form.get("published_at") || "");
    const observedAt = publishedAt ? new Date(`${publishedAt}T23:59:59`).toISOString() : "";
    const projectionResponse = await fetch(`/api/runs/${runId}/stages/03/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "controlled_evidence_projection",
        bindings: [{
          source_id: sourceId,
          judgment_unit_ids: [unitId],
          subject_ref: unitTitle,
          observed_at: observedAt,
          direction: manualDirection,
        }],
      }),
    });
    const projectionResult = await projectionResponse.json();
    if (!projectionResponse.ok) {
      setAcquireMessage(projectionResult?.error || "证据绑定失败");
      setAcquireBusy(false);
      return;
    }
    setAcquireMessage("已补充 1 条完整证据（含来源与判断绑定），请到证据页确认或删除。本任务最多补充 1 条。");
    setManualTargetUnit("");
    setManualDirection("support");
    setAcquireBusy(false);
    router.refresh();
  }

  return <section className="card source-coverage-panel">
    <div className="panel-title">
      <div>
        <span>来源 → 证据</span>
        <strong>只走这一条主路径</strong>
      </div>
      <div className="coverage-meta">
        <span>{coverage.coverage_gap_count ? `${coverage.coverage_gap_count} 个判断证据不足` : "全部判断已有最低证据草稿"}</span>
        <span title="进度指标，不是停止补证或进入判断阶段的门槛">进度覆盖率 {(coverage.coverage_rate * 100).toFixed(0)}%</span>
        <span title="进度指标，不是停止补证或进入判断阶段的门槛">进度核验率 {(coverage.verification_rate * 100).toFixed(0)}%</span>
        {coverage.public_secondary_count ? <span>公开二手 {coverage.public_secondary_count}</span> : null}
      </div>
    </div>

    {!sources.length && !draftCount ? <ol className="evidence-main-path" aria-label="证据主路径">
      <li className={sources.length ? "done" : acquireOpen ? "current" : ""}>
        <em>1</em>
        <div>
          <strong>抓取并核验公开 URL</strong>
          <small>进入候选池，还不是证据</small>
        </div>
      </li>
      <li className={draftCount ? "done" : ""}>
        <em>2</em>
        <div>
          <strong>取证自动绑定判断单元，生成待核对事实</strong>
          <small>由模型自动完成，无需人工挂接</small>
        </div>
      </li>
      <li className={draftCount ? "current" : ""}>
        <em>3</em>
        <div>
          <strong>到证据审阅页确认</strong>
          <small>逐条或批量确认后才能进判断</small>
        </div>
      </li>
    </ol> : null}

    {!sources.length && !draftCount ? <p className="muted channel-note">
      自动补证会优先查询已接入的一手数据与官方来源；手动补证可粘贴公开 URL 并核验原文。
      覆盖率与核验率是<strong>进度指标</strong>：只要仍有单元尚缺项，系统不会仅凭覆盖率停补。
    </p> : null}

    {(draftCount > 0) ? (
      <div className="notice evidence-next-step">
        <strong>下一步：去证据审阅确认草稿</strong>
        <p>待核对事实不会自动变成已确认证据。</p>
        <Link className="button" href={`/runs/${runId}/evidence`}>打开证据审阅 →</Link>
      </div>
    ) : null}

    {coverage.unit_coverage.length ? <div className="unit-coverage-grid">
      {coverage.unit_coverage.map((unit) => (
        <div className={`unit-coverage-card ${unit.has_support_evidence && unit.meets_independence ? "ok" : "warn"}`} key={unit.unit_id}>
          <header>
            <strong>{unitTitleById.get(unit.unit_id) || "未命名判断"}</strong>
            <span className={`judgment-ceiling ${unit.evidence_ceiling === "J0" ? "blocked" : ""}`}>结论强度上限：{judgmentStrengthLabel(unit.evidence_ceiling)}</span>
          </header>
          <div className="unit-coverage-metrics">
            <span>可核验事实 {unit.usable_fact_count}</span>
            <span>支持 {unit.support_draft_count}</span>
            <span>反证 {unit.counter_draft_count}</span>
            <span>独立来源组 {unit.independent_source_groups}/{unit.minimum_independent_sources}</span>
          </div>
          <p><b>当前最薄弱环节：</b>{researcherLanguage(unit.weakest_link)}</p>
          <p><b>反证检查：</b>{counterStatusLabel(unit.counter_check_status)}</p>
          {unit.support_gap_kind === "unverified_bound_sources" && unit.blocked_sources.length ? <div className="unit-gap-actions">
            <strong>已绑来源未核验</strong>
            <ul>{unit.blocked_sources.map((blocked) => <li key={blocked.id}>
              <button type="button" className="linkish" onClick={() => {
                document.getElementById(`source-row-${blocked.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}>{blocked.title}</button>
              {blocked.failure_detail ? <small>{blocked.failure_detail}</small> : null}
            </li>)}</ul>
            <button type="button" className="button-secondary button-compact" onClick={() => {
              setAcquireOpen(true);
              document.getElementById("source-acquire")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>重新取得来源</button>
          </div> : null}
          {unit.support_gap_kind === "no_support_draft" && unit.candidate_sources.length ? <div className="unit-gap-actions">
            <strong>已有可核验来源尚未绑定</strong>
            <p className="muted">这些来源会在下一轮取证中被模型自动绑定到本判断；如需人工补一条完整证据，请用上方“① 补充一条完整证据”。</p>
            <ul>{unit.candidate_sources.map((candidate) => <li key={candidate.id}><span>{candidate.title}</span></li>)}</ul>
          </div> : null}
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

    {sources.length ? <details className="source-inventory" id="source-inventory">
      <summary><strong>已登记来源</strong><span>{sources.length} 条 · 按需展开核对</span></summary>
      <ul className="source-list">
        {sources.map((source) => {
          const lifecycle = deriveSourceResearchLifecycle({
            retrievalStatus: source.retrieval_status,
            quoteVerified: Boolean(source.quote_verified),
            factStatus: source.fact_status,
          });
          return <li key={source.id} id={`source-row-${source.id}`}>
            <div className="source-row-head">
              {/^https?:\/\//i.test(source.url || "") ? (
                <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
              ) : (
                <span className="source-title-no-link">{source.title} <small className="mcp-note">（MCP 快照，无可点击原文，靠快照复核）</small></span>
              )}
              <span className={`source-research-state state-${lifecycle.stage}`}>{lifecycle.label}</span>
            </div>
            <small className="source-provenance-line">
              {authorityTypeLabel(source.authority_type || "unknown")} · {source.publisher || "未知发布者"} · {source.published_at || "发布日期未知"}
              · {usabilityLabel(source.usability_status || "candidate")} / {retrievalLabel(source.retrieval_status || "not_attempted")}
            </small>
            <div className="source-lifecycle" aria-label={`来源研究状态：${lifecycle.label}`}>
              <span className="done"><i>1</i>线索</span>
              <span className={lifecycle.bodyCaptured ? "done" : ""}><i>2</i>正文</span>
              <span className={lifecycle.quoteVerified ? "done" : ""}><i>3</i>引文</span>
              <span className={lifecycle.evidenceFact ? "done" : lifecycle.factDraft ? "pending" : ""}>
                <i>4</i>{lifecycle.factDraft ? "事实待核对" : "事实"}
              </span>
            </div>
            {source.failure_detail ? <small className="source-failure-detail">未能继续：{source.failure_detail}</small> : null}
          </li>;
        })}
      </ul>
    </details> : null}

    {unboundCandidates.length ? <p className="muted">另有 {unboundCandidates.length} 条来源尚未挂到任何判断单元。</p> : null}

    <div className="coverage-actions">
      <button type="button" className="button" disabled={manualCapReached} onClick={() => setAcquireOpen((value) => !value)}>
        {acquireOpen
          ? "收起补充"
          : manualCapReached
            ? "① 已补充 1 条完整证据（达上限）"
            : unitGapCount
              ? `① 补充一条完整证据（${unitGapCount} 个判断仍不足）`
              : "① 补充一条完整证据"}
      </button>
      <Link className="button-secondary" href={`/runs/${runId}/evidence`}>② 证据审阅（确认 / 删除）</Link>
    </div>
    {manualCapReached ? <p className="muted">本任务已补充 1 条完整证据，达到上限；如需更换，请先到证据页删除该条，再回来补充。</p> : null}

    {acquireOpen && !manualCapReached ? <form className="source-acquire-form" id="source-acquire" onSubmit={acquireSource}>
      <div className="source-form-grid">
        <div className="field source-url"><label>公开 URL</label><input name="url" type="url" required /></div>
        <div className="field"><label>来源标题</label><input name="title" required /></div>
        <div className="field"><label>发布者</label><input name="publisher" required /></div>
        <div className="field"><label>发布日期</label><input name="published_at" type="date" required /></div>
        <div className="field"><label>支持的判断单元</label>
          <select name="judgment_unit_id" value={manualTargetUnit} onChange={(event) => setManualTargetUnit(event.target.value)} required>
            <option value="">— 请选择 —</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
          </select>
        </div>
        <div className="field"><label>证据方向</label>
          <select name="direction" value={manualDirection} onChange={(event) => setManualDirection(event.target.value as "support" | "weaken" | "neutral")}>
            <option value="support">支持</option>
            <option value="weaken">削弱 / 反证</option>
            <option value="neutral">背景 / 中性</option>
          </select>
        </div>
        <div className="field source-wide"><label>页内定位</label><input name="locator" placeholder="段落标题、表格行或 quote:…" required /></div>
        <div className="field source-wide"><label>正文逐字引用</label><textarea name="source_quote" placeholder="必须能在抓取正文中逐字定位，至少 20 个字符" required /></div>
      </div>
      <details className="source-tech-details">
        <summary>高级来源字段</summary>
        <div className="source-form-grid">
          <div className="field"><label>来源权威类型</label>
            <select name="authority_type" defaultValue="company_disclosure" required>
              {ACQUIRE_AUTHORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field"><label>来源等级</label><select name="source_tier" defaultValue="S2">{ONTOLOGY_SOURCE_TIERS.map((tier) => <option key={tier} value={tier}>{tier} · {sourceTierLabel(tier)}</option>)}</select></div>
          <div className="field"><label>独立来源组（可选）</label><input name="source_group" placeholder="默认使用发布者" /></div>
        </div>
      </details>
      {acquireMessage ? <div className="notice">{acquireMessage}</div> : null}
      <button className="button" disabled={acquireBusy}>{acquireBusy ? "正在抓取并核验…" : "补充这条完整证据"}</button>
    </form> : null}

    {null}
  </section>;
}
