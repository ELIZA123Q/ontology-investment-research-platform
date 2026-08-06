"use client";

import { useMemo, useState } from "react";
import type { ArtifactPayload } from "@/storage/db_read_models";
import { EVALUATION_CRITERIA as criteria } from "@/schemas/schemas";
import { parseJson } from "@/schemas/types";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { researcherMarkdown } from "@/app/lib/researcher-stage-output";

export function CompareWorkspace({ runId, baseline, runtime, evaluation, metrics, canEvaluate, readOnly = false }: {
  runId: string;
  baseline: ArtifactPayload;
  runtime: ArtifactPayload;
  evaluation?: ArtifactPayload;
  metrics: Record<string, unknown>;
  canEvaluate: boolean;
  readOnly?: boolean;
}) {
  const sideA = useMemo(() => {
    let value = 0;
    for (const character of runId) value = (value + character.charCodeAt(0)) % 997;
    return value % 2 === 0 ? "baseline" : "runtime";
  }, [runId]);
  const prior: any = parseJson(evaluation?.json_content || "{}", {});
  const [scores, setScores] = useState<Record<string, number>>(prior.scores || {});
  const [notes, setNotes] = useState(evaluation ? researcherMarkdown(prior.notes) : String(prior.notes || ""));
  const [evaluator, setEvaluator] = useState(String(prior.evaluator || ""));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(Boolean(evaluation));
  const [error, setError] = useState("");
  const a = sideA === "baseline" ? baseline : runtime;
  const b = sideA === "baseline" ? runtime : baseline;

  async function save() {
    if (readOnly) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/runs/${runId}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scores, notes, evaluator }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "盲评保存失败");
      return;
    }
    setSaved(true);
  }

  return <>
    <div className="two-col">
      <section className="card compare-pane"><span className="badge">方案 A</span><article className="markdown"><ReportMarkdown content={a.markdown_content} readerView /></article></section>
      <section className="card compare-pane"><span className="badge">方案 B</span><article className="markdown"><ReportMarkdown content={b.markdown_content} readerView /></article></section>
    </div>
    {readOnly && !evaluation ? <section className="card" style={{ marginTop: 20 }}>
      <h2>历史盲评未完成</h2>
      <p className="muted">保留两份历史输入供复核，但此只读入口不再接受评分或补生成评测产物。</p>
    </section> : null}
    {readOnly && !evaluation ? null : (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{readOnly ? "历史盲评结果" : "盲评"}</h2>
      <p className="muted">{readOnly ? "以下结果只读保留，不属于当前研究完成或交付条件。" : "分别为 A、B 两个方案评分 1—5；提交后才揭示身份和确定性指标，揭示后不得重评。"}</p>
      <div className="score-grid">{criteria.flatMap((criterion) => ["A", "B"].map((side) => <label key={`${side}:${criterion}`}>
        {side} · {criterion}
        <select disabled={saved || readOnly} value={scores[`${side}:${criterion}`] || ""} onChange={(event) => setScores({ ...scores, [`${side}:${criterion}`]: Number(event.target.value) })}>
          <option value="">选择</option>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>))}</div>
      <div className="field"><label>评价人标识</label><input disabled={saved || readOnly} value={evaluator} onChange={(event) => setEvaluator(event.target.value)} placeholder="例如：主研究员 / Codex 运行验收" /></div>
      <div className="field"><label>对比备注</label><textarea disabled={saved || readOnly} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="说明评分依据、最大差异和不确定性" /></div>
      {!readOnly ? <button className="button" disabled={saved || busy || !canEvaluate || evaluator.trim().length < 2 || notes.trim().length < 8 || Object.keys(scores).length !== criteria.length * 2} onClick={save}>保存评价并揭示</button> : null}
      {!canEvaluate && !saved ? <div className="notice">基线和交付报告都必须先确认，才能锁定盲评输入。</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
      {saved ? <>
        <div className="notice">方案 A 是 {sideA === "baseline" ? "同证据对照基线" : "结构化研究路径"}；方案 B 是 {sideA === "baseline" ? "结构化研究路径" : "同证据对照基线"}。该评价已锁定。</div>
        <h3>可核验差异</h3>
        <div className="compare-metrics">
          {comparisonMetricRows(metrics, sideA).map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>A：{row.a} · B：{row.b}</strong>
            </div>
          ))}
        </div>
        <details className="source-tech-details">
          <summary>审计：原始指标</summary>
          <pre>{JSON.stringify(metrics, null, 2)}</pre>
        </details>
      </> : null}
    </section>
    )}
  </>;
}

type MetricRecord = Record<string, unknown>;

function record(value: unknown): MetricRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as MetricRecord : {};
}

function comparisonMetricRows(metrics: Record<string, unknown>, sideA: "baseline" | "runtime") {
  const baseline = record(metrics.baseline);
  const runtime = record(metrics.runtime);
  const baselineCounter = Number(baseline.counterpoints_count || 0);
  const runtimeCounter = Number(runtime.counterevidence_fact_count || 0)
    + Number(runtime.active_competing_explanation_count || 0);
  const rows = [
    {
      label: "可打开的来源",
      baseline: `${formatMetricValue(baseline.clickable_sources)} 个`,
      runtime: `${formatMetricValue(runtime.clickable_sources)} 个`,
    },
    {
      label: "有来源支撑的结论",
      baseline: formatRatio(baseline.supported_claim_ratio),
      runtime: formatRatio(runtime.supported_claim_ratio),
    },
    {
      label: "已显式记录的反证或竞争解释",
      baseline: `${formatMetricValue(baselineCounter)} 条`,
      runtime: `${formatMetricValue(runtimeCounter)} 条`,
    },
    {
      label: "限制与改判边界",
      baseline: `${formatMetricValue(baseline.limitations_count)} 条`,
      runtime: `${formatMetricValue(runtime.limitations_count)} 条`,
    },
  ];
  return rows.map((row) => ({
    label: row.label,
    a: sideA === "baseline" ? row.baseline : row.runtime,
    b: sideA === "baseline" ? row.runtime : row.baseline,
  }));
}

function formatRatio(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "—";
}

function formatMetricValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
