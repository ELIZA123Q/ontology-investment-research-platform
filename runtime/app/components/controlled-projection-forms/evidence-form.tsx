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
          }} /> {unit.title}</label>)}</div>
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

