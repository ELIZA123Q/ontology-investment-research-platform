"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, BackgroundVariant, Controls, Position, ReactFlow, useEdgesState, useNodesState, type Edge, type Node } from "@xyflow/react";
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

function focusNeighborhood(selectedId: string, inputEdges: ResearchGraphEdge[]) {
  const nodeIds = new Set<string>(selectedId ? [selectedId] : []);
  const edgeIds = new Set<string>();
  if (!selectedId) return { nodeIds, edgeIds };
  for (const edge of inputEdges) {
    if (edge.source !== selectedId && edge.target !== selectedId) continue;
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return { nodeIds, edgeIds };
}

function toFlowNodes(
  inputNodes: ResearchGraphNode[],
  selectedId: string,
  focusNodeIds: Set<string>,
  hasFocus: boolean,
): Node[] {
  return inputNodes.map((item) => {
    const focused = !hasFocus || focusNodeIds.has(item.id);
    return {
      id: item.id,
      position: { x: item.x, y: item.y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: <div className="graph-node-copy"><span>{item.meta}</span><strong>{item.label}</strong></div> },
      className: `research-graph-node tone-${item.tone}${focused ? " is-focused" : " is-dimmed"}`,
      draggable: true,
      selectable: true,
      selected: item.id === selectedId,
    };
  });
}

function toFlowEdges(
  inputEdges: ResearchGraphEdge[],
  focusEdgeIds: Set<string>,
  hasFocus: boolean,
): Edge[] {
  return inputEdges.map((item) => {
    const focused = !hasFocus || focusEdgeIds.has(item.id);
    const tone = item.tone || "neutral";
    return {
      id: item.id,
      source: item.source,
      target: item.target,
      type: "smoothstep",
      label: item.label,
      animated: focused && tone === "danger",
      className: focused ? "is-focused" : "is-dimmed",
      style: {
        stroke: colors[tone],
        strokeWidth: focused ? 2.4 : 1.2,
        opacity: focused ? 1 : 0.12,
      },
      labelStyle: { fill: "#687680", fontSize: 10, opacity: focused ? 1 : 0.12 },
      zIndex: focused ? 8 : 0,
      pathOptions: { borderRadius: 14, offset: 28 },
    };
  });
}

function detailEntries(details: ResearchGraphNode["details"] | unknown): Array<[string, unknown]> {
  if (!details) return [];
  if (typeof details === "string") return details.trim() ? [["内容", details]] : [];
  if (typeof details !== "object" || Array.isArray(details)) return [["内容", details]];
  return Object.entries(details as Record<string, unknown>);
}

export function ResearchGraph({ nodes: inputNodes, edges: inputEdges, emptyMessage = "当前还没有可视化对象", runId, workItems = [] }: {
  nodes: ResearchGraphNode[];
  edges: ResearchGraphEdge[];
  emptyMessage?: string;
  runId?: string;
  workItems?: Array<Pick<ResearchWorkItem, "id" | "target_id" | "status" | "title" | "reason" | "stage" | "kind">>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(inputNodes[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const selected = inputNodes.find((item) => item.id === selectedId);
  const selectedWorkItem = workItems.find((item) => item.target_id === selectedId && (item.status === "pending" || item.status === "rework"));
  const focus = useMemo(() => focusNeighborhood(selectedId, inputEdges), [selectedId, inputEdges]);
  const hasFocus = Boolean(selectedId);
  const styledNodes = useMemo(
    () => toFlowNodes(inputNodes, selectedId, focus.nodeIds, hasFocus),
    [inputNodes, selectedId, focus.nodeIds, hasFocus],
  );
  const styledEdges = useMemo(
    () => toFlowEdges(inputEdges, focus.edgeIds, hasFocus),
    [inputEdges, focus.edgeIds, hasFocus],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(styledNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(styledEdges);

  useEffect(() => {
    setNodes((current) => {
      const positionById = new Map(current.map((node) => [node.id, node.position]));
      return styledNodes.map((node) => ({
        ...node,
        position: positionById.get(node.id) || node.position,
      }));
    });
  }, [styledNodes, setNodes]);

  useEffect(() => {
    setEdges(styledEdges);
  }, [styledEdges, setEdges]);

  useEffect(() => {
    if (!selectedId && inputNodes[0]?.id) setSelectedId(inputNodes[0].id);
    else if (selectedId && !inputNodes.some((node) => node.id === selectedId)) {
      setSelectedId(inputNodes[0]?.id || "");
    }
  }, [inputNodes, selectedId]);

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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        defaultEdgeOptions={{ type: "smoothstep" }}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.35}
        maxZoom={1.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId("")}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9e0df" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <aside className="graph-inspector">
      <div className="eyebrow">节点详情</div>
      {selected ? <>
        <h2>{selected.label}</h2>
        <span className={`semantic-key tone-${selected.tone}`}>{selected.meta}</span>
        <dl>
          {detailEntries(selected.details).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatValue(value)}</dd></div>)}
        </dl>
        {selectedWorkItem ? <div className="graph-review-actions"><div><span>{selectedWorkItem.kind}</span><strong>{selectedWorkItem.title}</strong><small>{selectedWorkItem.reason || `退回 ${selectedWorkItem.stage}`}</small></div><div className="field"><label>人工裁决记录</label><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="说明证据上限、竞争解释和结论边界的核对结果" /></div><div className="review-actions"><button className="button" disabled={busy} onClick={() => decide("approved")}>确认裁决</button><button className="button-secondary" disabled={busy} onClick={() => decide("rework")}>退回返工</button></div>{error ? <div className="notice error">{error}</div> : null}</div> : null}
      </> : <p className="muted">点击节点查看详情；选中后仅高亮相邻节点与连线。</p>}
    </aside>
  </div>;
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.map(String).join("；") : "—";
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === undefined || value === null || value === "" ? "—" : String(value);
}
