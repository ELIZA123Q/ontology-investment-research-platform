"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, BackgroundVariant, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { ResearchWorkItem } from "@/engine/types";

export type ResearchGraphNode = {
  id: string;
  label: string;
  meta: string;
  tone: "support" | "weaken" | "danger" | "unknown" | "inherited" | "neutral";
  x: number;
  y: number;
  details: Record<string, unknown>;
};

export type ResearchGraphEdge = { id: string; source: string; target: string; tone?: ResearchGraphNode["tone"]; label?: string };

const colors: Record<string, string> = {
  support: "#168b78",
  weaken: "#bd7a1d",
  danger: "#bd5046",
  inherited: "#4f73c8",
  unknown: "#8a969c",
  neutral: "#738087",
};

export function ResearchGraph({ nodes: inputNodes, edges: inputEdges, emptyMessage = "当前还没有可视化对象", runId, workItems = [] }: { nodes: ResearchGraphNode[]; edges: ResearchGraphEdge[]; emptyMessage?: string; runId?: string; workItems?: ResearchWorkItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(inputNodes[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const selected = inputNodes.find((item) => item.id === selectedId);
  const selectedWorkItem = workItems.find((item) => item.target_id === selectedId && (item.status === "pending" || item.status === "rework"));
  const nodes = useMemo<Node[]>(() => inputNodes.map((item) => ({
    id: item.id,
    position: { x: item.x, y: item.y },
    data: { label: <div className="graph-node-copy"><span>{item.meta}</span><strong>{item.label}</strong></div> },
    className: `research-graph-node tone-${item.tone}`,
    draggable: false,
    selectable: true,
  })), [inputNodes]);
  const edges = useMemo<Edge[]>(() => inputEdges.map((item) => ({
    id: item.id,
    source: item.source,
    target: item.target,
    label: item.label,
    animated: item.tone === "danger",
    style: { stroke: colors[item.tone || "neutral"], strokeWidth: 1.7 },
    labelStyle: { fill: "#687680", fontSize: 10 },
  })), [inputEdges]);

  async function decide(status: "approved" | "rework") {
    if (!runId || !selectedWorkItem) return;
    if (reviewNote.trim().length < 8) {
      setError("请先留下至少 8 个字的裁决依据。");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/work-items/${selectedWorkItem.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note: reviewNote.trim(), resolution: status === "approved" ? "accepted_judgment" : "rework_requested" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "更新工作项失败");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!inputNodes.length) return <div className="card empty-state"><h2>尚无图谱</h2><p className="muted">{emptyMessage}</p></div>;
  return <div className="graph-workspace">
    <div className="graph-canvas">
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.35} maxZoom={1.5} nodesConnectable={false} elementsSelectable onNodeClick={(_, node) => setSelectedId(node.id)}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9e0df" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <aside className="graph-inspector">
      <div className="eyebrow">Node inspector</div>
      <h2>{selected?.label}</h2>
      <span className={`semantic-key tone-${selected?.tone || "neutral"}`}>{selected?.meta}</span>
      <dl>
        {Object.entries(selected?.details || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatValue(value)}</dd></div>)}
      </dl>
      {selectedWorkItem ? <div className="graph-review-actions"><div><span>{selectedWorkItem.kind}</span><strong>{selectedWorkItem.title}</strong><small>{selectedWorkItem.reason || `退回 ${selectedWorkItem.stage}`}</small></div><div className="field"><label>人工裁决记录</label><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="说明证据上限、竞争解释和结论边界的核对结果" /></div><div className="review-actions"><button className="button" disabled={busy} onClick={() => decide("approved")}>确认裁决</button><button className="button-secondary" disabled={busy} onClick={() => decide("rework")}>退回返工</button></div>{error ? <div className="notice error">{error}</div> : null}</div> : null}
      <details className="advanced-audit"><summary>高级审计字段</summary><pre>{JSON.stringify(selected?.details || {}, null, 2)}</pre></details>
    </aside>
  </div>;
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.map(String).join("；") : "—";
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === undefined || value === null || value === "" ? "—" : String(value);
}
