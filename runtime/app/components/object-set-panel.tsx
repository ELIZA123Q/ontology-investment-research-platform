"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { actionLabel, authorityLabel, objectTypeLabel } from "@/app/lib/ui-labels";

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
    const r = await fetch(`/api/runs/${runId}/actions/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action_id: actionId, parameters }),
    });
    const json = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(json.error || "提出操作建议失败");
      return;
    }
    setProposal(json);
  }

  async function approveProposal() {
    const workItemId = proposal?.approval_work_item?.id;
    if (!workItemId) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/runs/${runId}/work-items/${workItemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", note: "由关系图面板人工批准操作建议" }),
    });
    const workItem = await response.json();
    setBusy(false);
    if (!response.ok) { setError(workItem.error || "批准失败"); return; }
    setProposal((current: any) => ({ ...current, proposal: { ...current.proposal, status: "approved" }, approval_work_item: workItem }));
  }

  async function executeProposal() {
    const stored = proposal?.proposal;
    if (!stored?.id) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/runs/${runId}/actions/${stored.id}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_graph_version: stored.expected_graph_version }),
    });
    const execution = await response.json();
    setBusy(false);
    if (!response.ok) { setError(execution.error || "执行失败"); return; }
    setProposal((current: any) => ({ ...current, proposal: { ...current.proposal, status: "executed" }, execution }));
    await load();
  }

  const authorityText = data?.authority ? authorityLabel(data.authority) : "";
  const provisionalNote = data?.provisional_projection?.note?.includes("草稿投影")
    ? "以下为草稿预览，尚未写入正式关系图"
    : data?.provisional_projection?.note;

  return (
    <div className="object-set">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="panel-title">
          <div><span>对象查询</span><strong>{data?.total_objects || 0}</strong></div>
          <small>{authorityText || "正在读取关系图"}</small>
        </div>
        <p className="muted">按研究对象查询并提出受控写入建议；日常修改判断请返回对应阶段页面。</p>
        <div className="actions" style={{ alignItems: "end" }}>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>对象类型</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="对象类型">
              <option value="JudgmentUnit">判断单元</option>
              <option value="EvidenceFact">证据事实</option>
              <option value="EvidenceRequirement">证据要求</option>
              <option value="Source">来源</option>
              <option value="Judgment">判断</option>
              <option value="">全部类型</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>关联对象</label>
            <input value={relatedTo} onChange={(e) => setRelatedTo(e.target.value)} placeholder="对象编号" />
          </div>
          <button className="button" disabled={busy} onClick={load}>
            查询
          </button>
          <button className="button-secondary" disabled={busy || !selected} onClick={propose}>
            对选中对象提出操作建议
          </button>
          <Link className="button-quiet" href={`/runs/${runId}`}>返回研究</Link>
        </div>
        {data?.provisional_projection ? (
          <div className="notice">{provisionalNote}：{data.provisional_projection.summary}</div>
        ) : null}
        {error ? <div className="notice error">{error}</div> : null}
        <p className="muted">可执行操作：{(data?.supported_actions || []).map(actionLabel).join("、") || "暂无"}</p>
      </div>

      <div className="three-col">
        <aside className="card ontology-list">
          <h3>对象列表（{data?.total_objects || 0}）</h3>
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
              <strong>{objectLabel(object)}</strong>
              <br />
              <small className="muted">{objectTypeLabel(object.type)}</small>
            </button>
          ))}
        </aside>
        <section className="card">
          <h2>对象详情</h2>
          {selected ? (
            <>
              <p>
                <span className="badge">{objectTypeLabel(selected.type)}</span> {objectLabel(selected)}
              </p>
              <details className="structure-advanced">
                <summary>高级：原始属性 JSON</summary>
                <pre className="json-editor" style={{ minHeight: 280, overflow: "auto" }}>
                  {JSON.stringify(selected.properties || {}, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="muted">选择左侧对象</p>
          )}
        </section>
        <section className="card">
          <h2>相关关系 / 操作变更预览</h2>
          {related.length ? (
            <ul className="source-list">
              {related.map((relation) => (
                <li key={relation.id}>{relationLabel(relation.type)} · {objectName(data?.objects, relation.sourceId)} → {objectName(data?.objects, relation.targetId)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">当前对象暂无相关关系</p>
          )}
          {proposal ? (
            <>
              <h3>操作建议</h3>
              <div className="actions">
                <button className="button-secondary" disabled={busy || proposal.approval_work_item?.status === "approved" || proposal.proposal?.status === "executed"} onClick={approveProposal}>人工批准</button>
                <button className="button" disabled={busy || proposal.approval_work_item?.status !== "approved" || proposal.proposal?.status === "executed"} onClick={executeProposal}>确认后写入正式关系图</button>
              </div>
              <details className="structure-advanced">
                <summary>高级：操作建议 JSON</summary>
                <pre className="json-editor" style={{ minHeight: 240, overflow: "auto" }}>
                  {JSON.stringify(proposal, null, 2)}
                </pre>
              </details>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function objectLabel(object: { id: string; type: string; properties?: Record<string, unknown> }) {
  const props = object.properties || {};
  const title = String(props.title || props.statement || props.question || props.label || "").trim();
  return title || objectTypeLabel(object.type);
}

function objectName(
  objects: ObjectSetResponse["objects"],
  id: string,
) {
  const object = objects?.find((item) => item.id === id);
  return object ? objectLabel(object) : "关联对象";
}

function relationLabel(type: string) {
  return ({
    supports: "支持",
    weakens: "削弱",
    derivedFrom: "来自",
    basedOn: "依据",
    targets: "指向",
    affects: "影响",
    requires: "需要",
  } as Record<string, string>)[type] || "相关";
}
