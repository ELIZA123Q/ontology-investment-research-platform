"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ObjectSetResponse = {
  authority?: string;
  graph_source?: string;
  summary?: string;
  objects?: Array<{ id: string; type: string; properties?: Record<string, unknown> }>;
  relations?: Array<{ id: string; type: string; sourceId: string; targetId: string }>;
  total_objects?: number;
  supported_actions?: string[];
  provisional_projection?: { summary: string; note: string } | null;
  error?: string;
};

export function ObjectSetPanel({ runId }: { runId: string }) {
  const [typeFilter, setTypeFilter] = useState("JudgmentUnit");
  const [relatedTo, setRelatedTo] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState<ObjectSetResponse | null>(null);
  const [proposal, setProposal] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    const params = new URLSearchParams({ limit: "80", includeProvisional: "1" });
    if (typeFilter) params.set("type", typeFilter);
    if (relatedTo) params.set("relatedTo", relatedTo);
    const r = await fetch(`/api/runs/${runId}/object-set?${params}`);
    const json = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(json.error || "查询失败");
      return;
    }
    setData(json);
    if (!selectedId && json.objects?.[0]?.id) setSelectedId(json.objects[0].id);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const selected = useMemo(() => data?.objects?.find((o) => o.id === selectedId) || null, [data, selectedId]);
  const related = useMemo(() => {
    if (!selected || !data?.relations) return [];
    return data.relations.filter((r) => r.sourceId === selected.id || r.targetId === selected.id);
  }, [data, selected]);

  async function propose() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const actionId = selected.type === "SourceDocument" || selected.type === "EvidenceClaim"
      ? "AssessEvidenceForUse"
      : selected.type === "Judgment"
        ? "RecordReasoningTrace"
        : "FormJudgment";
    const parameters =
      actionId === "AssessEvidenceForUse"
        ? { evidenceRefs: [selected.id], assessmentScope: "object-set-panel" }
        : actionId === "RecordReasoningTrace"
          ? { judgmentRef: selected.id, status: "draft_proposal", steps: ["object-set-panel"] }
          : { statement: String(selected.properties?.statement || selected.properties?.conclusion || selected.id), evidenceRefs: [selected.id], judgmentLevel: "J1" };
    const r = await fetch(`/api/runs/${runId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "propose", action_id: actionId, parameters }),
    });
    const json = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(json.error || "提案失败");
      return;
    }
    setProposal(json.proposal || json);
  }

  return (
    <div className="object-set">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Object Set</div>
          <h1>运行实例集合</h1>
          <p className="muted">
            {data?.summary || "查询 business_instance_graph"}
            {data?.authority ? ` · 权威=${data.authority}` : ""}
            {data?.graph_source ? ` · ${data.graph_source}` : ""}
          </p>
        </div>
        <div className="actions">
          <Link className="button-secondary" href={`/runs/${runId}`}>
            ← 返回运行
          </Link>
          <button className="button-secondary" disabled={busy} onClick={load}>
            刷新
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="actions" style={{ alignItems: "end" }}>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>对象类型</label>
            <input value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="JudgmentUnit" />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>relatedTo</label>
            <input value={relatedTo} onChange={(e) => setRelatedTo(e.target.value)} placeholder="对象 ID" />
          </div>
          <button className="button" disabled={busy} onClick={load}>
            查询
          </button>
          <button className="button-secondary" disabled={busy || !selected} onClick={propose}>
            对选中对象提案 Action
          </button>
        </div>
        {data?.provisional_projection ? (
          <div className="notice">{data.provisional_projection.note}：{data.provisional_projection.summary}</div>
        ) : null}
        {error ? <div className="notice error">{error}</div> : null}
        <p className="muted">可执行 Action：{(data?.supported_actions || []).join("、")}</p>
      </div>

      <div className="three-col">
        <aside className="card ontology-list">
          <h3>Objects ({data?.total_objects || 0})</h3>
          {(data?.objects || []).map((object) => (
            <button
              key={object.id}
              className={object.id === selectedId ? "active" : ""}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: 0,
                background: object.id === selectedId ? "var(--mint)" : "transparent",
                padding: "9px 10px",
                borderRadius: 8,
                cursor: "pointer",
              }}
              onClick={() => setSelectedId(object.id)}
            >
              <strong>{object.id}</strong>
              <br />
              <small className="muted">{object.type}</small>
            </button>
          ))}
        </aside>
        <section className="card">
          <h2>对象详情</h2>
          {selected ? (
            <>
              <p>
                <span className="badge">{selected.type}</span> <code>{selected.id}</code>
              </p>
              <pre className="json-editor" style={{ minHeight: 280, overflow: "auto" }}>
                {JSON.stringify(selected.properties || {}, null, 2)}
              </pre>
            </>
          ) : (
            <p className="muted">选择左侧对象</p>
          )}
        </section>
        <section className="card">
          <h2>关系展开 / 提案 diff</h2>
          {related.length ? (
            <ul className="source-list">
              {related.map((relation) => (
                <li key={relation.id}>
                  <code>{relation.type}</code> · {relation.sourceId} → {relation.targetId}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">当前对象无关系边</p>
          )}
          {proposal ? (
            <>
              <h3>Action 提案</h3>
              <pre className="json-editor" style={{ minHeight: 240, overflow: "auto" }}>
                {JSON.stringify(proposal, null, 2)}
              </pre>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
