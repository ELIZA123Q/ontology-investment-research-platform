"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactPayload } from "@/adapters/db_read_models";
import { EVALUATION_CRITERIA as criteria } from "@/engine/schemas";
import { parseJson } from "@/engine/types";

export function CompareWorkspace({ runId, baseline, runtime, evaluation, metrics, canEvaluate }: {
  runId: string;
  baseline: ArtifactPayload;
  runtime: ArtifactPayload;
  evaluation?: ArtifactPayload;
  metrics: Record<string, unknown>;
  canEvaluate: boolean;
}) {
  const sideA = useMemo(() => {
    let value = 0;
    for (const character of runId) value = (value + character.charCodeAt(0)) % 997;
    return value % 2 === 0 ? "baseline" : "runtime";
  }, [runId]);
  const prior: any = parseJson(evaluation?.json_content || "{}", {});
  const [scores, setScores] = useState<Record<string, number>>(prior.scores || {});
  const [notes, setNotes] = useState(String(prior.notes || ""));
  const [evaluator, setEvaluator] = useState(String(prior.evaluator || ""));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(Boolean(evaluation));
  const [error, setError] = useState("");
  const a = sideA === "baseline" ? baseline : runtime;
  const b = sideA === "baseline" ? runtime : baseline;

  async function save() {
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
      <section className="card compare-pane"><span className="badge">方案 A</span><article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{a.markdown_content}</ReactMarkdown></article></section>
      <section className="card compare-pane"><span className="badge">方案 B</span><article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{b.markdown_content}</ReactMarkdown></article></section>
    </div>
    <section className="card" style={{ marginTop: 20 }}>
      <h2>盲评</h2>
      <p className="muted">分别为 A、B 两个方案评分 1—5；提交后才揭示身份和确定性指标，揭示后不得重评。</p>
      <div className="score-grid">{criteria.flatMap((criterion) => ["A", "B"].map((side) => <label key={`${side}:${criterion}`}>
        {side} · {criterion}
        <select disabled={saved} value={scores[`${side}:${criterion}`] || ""} onChange={(event) => setScores({ ...scores, [`${side}:${criterion}`]: Number(event.target.value) })}>
          <option value="">选择</option>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>))}</div>
      <div className="field"><label>评价人标识</label><input disabled={saved} value={evaluator} onChange={(event) => setEvaluator(event.target.value)} placeholder="例如：主研究员 / Codex 运行验收" /></div>
      <div className="field"><label>对比备注</label><textarea disabled={saved} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="说明评分依据、最大差异和不确定性" /></div>
      <button className="button" disabled={saved || busy || !canEvaluate || evaluator.trim().length < 2 || notes.trim().length < 8 || Object.keys(scores).length !== criteria.length * 2} onClick={save}>保存评价并揭示</button>
      {!canEvaluate && !saved ? <div className="notice">基线和阶段 05 都必须先确认，才能锁定盲评输入。</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
      {saved ? <><div className="notice">方案 A 是 {sideA === "baseline" ? "同证据对照基线" : "本体约束研究路径"}；方案 B 是 {sideA === "baseline" ? "本体约束研究路径" : "同证据对照基线"}。该评价已锁定。</div><pre>{JSON.stringify(metrics, null, 2)}</pre></> : null}
    </section>
  </>;
}
