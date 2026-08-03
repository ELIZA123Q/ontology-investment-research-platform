"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Controls, MarkerType, Position, ReactFlow,
  type Edge, type Node, type NodeChange, type ReactFlowInstance,
} from "@xyflow/react";
import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import type { OntologyGraphPreset } from "@/app/lib/ontology-network-graph";

export type KnowledgeGraphView = {
  id: string;
  label: string;
  hint: string;
  nodes: ResearchGraphNode[];
  edges: ResearchGraphEdge[];
  groupMode?: "entity" | "reasoning" | "research" | "ontology" | "candidate";
  emptyMessage?: string;
  presets?: OntologyGraphPreset[];
  rules?: Array<{ id: string; label: string; description: string; targetNodeIds: string[]; targetEdgeIds: string[] }>;
  defaultGroup?: string;
};

type RelationDepth = "1" | "2" | "all";
type GroupDefinition = { id: string; label: string; description: string };
type PositionMap = Record<string, Record<string, { x: number; y: number }>>;

export function mergeSessionNodePositions(
  viewId: string,
  current: PositionMap,
  changes: NodeChange<Node>[],
): PositionMap {
  const moved = changes.filter(
    (change): change is Extract<NodeChange<Node>, { type: "position" }> => change.type === "position" && Boolean(change.position),
  );
  if (!moved.length) return current;
  const nextView = { ...(current[viewId] || {}) };
  moved.forEach((change) => { if (change.position) nextView[change.id] = change.position; });
  return { ...current, [viewId]: nextView };
}

const colors: Record<ResearchGraphNode["tone"], string> = {
  support: "#0b7167", weaken: "#b97821", danger: "#b0443b", inherited: "#2e63d3", unknown: "#8a969c", neutral: "#65757b",
};

const groupDefinitions: Record<string, GroupDefinition> = {
  industry: { id: "industry", label: "产业与链条", description: "行业、产业链环节和区域" },
  company: { id: "company", label: "公司与设施", description: "公司、工厂、产线和交易主体" },
  product: { id: "product", label: "产品与技术", description: "产品、材料、设备、技术和工艺" },
  market: { id: "market", label: "应用与市场", description: "应用、资产、政策和金融工具" },
  question: { id: "question", label: "问题", description: "研究问题与拆解入口" },
  unit: { id: "unit", label: "判断单元", description: "需要独立回答的原子判断" },
  reasoning: { id: "reasoning", label: "信号与假设", description: "支持、削弱、竞争解释与阻断" },
  judgment: { id: "judgment", label: "判断", description: "经过规则约束的研究结论" },
  core: { id: "core", label: "核心业务", description: "公司、行业、产品及其业务关系" },
  state: { id: "state", label: "状态与事件", description: "变量、观测、状态变化和事件" },
  evidence: { id: "evidence", label: "证据与判断", description: "证据、假设、规则评估和判断" },
  structure: { id: "structure", label: "研究结构", description: "研究范围、问题、方法和治理结构" },
  local: { id: "local", label: "任务候选", description: "仅在当前任务生效的非正式概念" },
  recommend: { id: "recommend", label: "建议治理", description: "跨研究复用较强，建议进入正式本体" },
  observe: { id: "observe", label: "继续观察", description: "当前复用证据不足" },
};

function display(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(display).join("、") : "—";
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

export function knowledgeGraphGroupId(node: ResearchGraphNode, mode: KnowledgeGraphView["groupMode"]): string {
  if (node.meta.includes("非正式") || node.meta.includes("候选")) {
    if (mode === "candidate") return String(node.details?.建议 || "").startsWith("建议") ? "recommend" : "observe";
    return "local";
  }
  const type = String(node.details?.技术类型 || node.details?.类型 || "");
  if (mode === "entity") {
    if (["Industry", "ValueChainSegment", "Region"].includes(type)) return "industry";
    if (["Company", "ManufacturingFacility", "ProductionLine", "TradingVenue", "Listing"].includes(type)) return "company";
    if (["Product", "Material", "SemiconductorMaterial", "SemiconductorEquipment", "Technology", "TechnologyRoute", "ProcessStep"].includes(type)) return "product";
    return "market";
  }
  if (mode === "reasoning" || mode === "research") {
    if (type === "ResearchQuestion") return "question";
    if (type === "JudgmentUnit") return "unit";
    if (type === "Judgment") return "judgment";
    if (mode === "research" && ["EvidenceFact", "EvidenceClaim", "EvidenceRequirement", "EvidenceAssessment", "EvidenceBasket", "SourceDocument"].includes(type)) return "reasoning";
    return "reasoning";
  }
  if (mode === "ontology") {
    const group = String(node.details?.知识分组 || node.meta.split("·")[0]).trim();
    return ({ 核心业务: "core", 状态与事件: "state", 证据与判断: "evidence", 研究结构: "structure", 任务专用候选: "local" } as Record<string, string>)[group] || "core";
  }
  return "observe";
}

export function collectRelatedNetwork(selectedId: string, edges: ResearchGraphEdge[], depth: RelationDepth) {
  const nodeIds = new Set<string>(selectedId ? [selectedId] : []);
  const edgeIds = new Set<string>();
  if (!selectedId) return { nodeIds, edgeIds };
  let frontier = new Set([selectedId]);
  const rounds = depth === "all" ? Number.POSITIVE_INFINITY : Number(depth);
  let round = 0;
  while (frontier.size && round < rounds) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (!frontier.has(edge.source) && !frontier.has(edge.target)) continue;
      edgeIds.add(edge.id);
      for (const id of [edge.source, edge.target]) if (!nodeIds.has(id)) { nodeIds.add(id); next.add(id); }
    }
    frontier = next;
    round += 1;
  }
  return { nodeIds, edgeIds };
}

export function KnowledgeGraphWorkspace({ views, initialView, queryKey }: { views: KnowledgeGraphView[]; initialView?: string; queryKey?: string }) {
  const [viewId, setViewId] = useState(initialView || views[0]?.id || "");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [edgeType, setEdgeType] = useState("");
  const [edgeStatus, setEdgeStatus] = useState("");
  const [groupId, setGroupId] = useState("");
  const [presetId, setPresetId] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [relationDepth, setRelationDepth] = useState<RelationDepth>("1");
  const [focusOnly, setFocusOnly] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [positions, setPositions] = useState<PositionMap>({});
  const [instance, setInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const active = views.find((view) => view.id === viewId) || views[0];
  const selectedPreset = active?.presets?.find((preset) => preset.id === presetId);
  const selectedRule = active?.rules?.find((rule) => rule.id === ruleId);
  const types = useMemo(() => {
    const result = new Map<string, { value: string; label: string }>();
    for (const node of active?.nodes || []) {
      const value = String(node.details?.技术类型 || node.details?.类型 || node.meta.split("·")[0]).trim();
      result.set(value, { value, label: String(node.details?.类型 || node.meta.split("·")[0]).trim() });
    }
    return [...result.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }, [active]);
  const edgeTypes = useMemo(() => {
    const result = new Map<string, { value: string; label: string }>();
    for (const edge of active?.edges || []) {
      const value = String(edge.details?.技术关系ID || edge.details?.技术关系 || edge.details?.关系ID || edge.label || "").trim();
      if (value) result.set(value, { value, label: String(edge.label || value) });
    }
    return [...result.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }, [active]);
  const edgeStatuses = useMemo(() => [...new Set((active?.edges || []).map((edge) => String(edge.details?.关系状态 || edge.details?.状态 || "").trim()).filter(Boolean))].sort(), [active]);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of active?.nodes || []) { const id = knowledgeGraphGroupId(node, active.groupMode); counts.set(id, (counts.get(id) || 0) + 1); }
    const order = active?.groupMode === "entity" ? ["industry", "company", "product", "market"]
      : active?.groupMode === "reasoning" || active?.groupMode === "research" ? ["question", "unit", "reasoning", "judgment"]
        : active?.groupMode === "candidate" ? ["recommend", "observe"] : ["core", "state", "evidence", "structure", "local"];
    return [...counts.entries()].map(([id, count]) => ({ ...(groupDefinitions[id] || { id, label: id, description: "" }), count }))
      .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  }, [active]);

  const selectionSeed = selectedNodeId || (selectedEdgeId ? active?.edges.find((edge) => edge.id === selectedEdgeId)?.source || "" : "");
  const related = useMemo(() => {
    if (selectedEdgeId) {
      const edge = active?.edges.find((item) => item.id === selectedEdgeId);
      return { nodeIds: new Set(edge ? [edge.source, edge.target] : []), edgeIds: new Set(edge ? [edge.id] : []) };
    }
    return collectRelatedNetwork(selectionSeed, active?.edges || [], relationDepth);
  }, [active, relationDepth, selectedEdgeId, selectionSeed]);

  const filtered = useMemo(() => {
    if (!active) return { nodes: [] as ResearchGraphNode[], edges: [] as ResearchGraphEdge[], primaryCount: 0, primaryIds: new Set<string>() };
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const presetNodes = new Set(selectedPreset?.nodeIds || []);
    const presetRelations = new Set(selectedPreset?.relationIds || []);
    const ruleNodes = new Set(selectedRule?.targetNodeIds || []);
    const ruleEdges = new Set(selectedRule?.targetEdgeIds || []);
    let primary = active.nodes.filter((node) => (!groupId || knowledgeGraphGroupId(node, active.groupMode) === groupId)
      && (!type || String(node.details?.技术类型 || node.details?.类型 || node.meta.split("·")[0]).trim() === type)
      && (!selectedPreset || presetNodes.has(node.id))
      && (!selectedRule || ruleNodes.has(node.id)));
    let primaryEdges = active.edges.filter((edge) => {
      const relationId = String(edge.details?.关系ID || edge.details?.技术关系ID || edge.details?.技术关系 || "");
      const relationStatus = String(edge.details?.关系状态 || edge.details?.状态 || "");
      return (!selectedPreset || presetRelations.has(relationId)) && (!selectedRule || ruleEdges.has(edge.id))
        && (!edgeType || relationId === edgeType || edge.label === edgeType) && (!edgeStatus || relationStatus === edgeStatus);
    });
    if (edgeType || edgeStatus) {
      const edgeEndpointIds = new Set(primaryEdges.flatMap((edge) => [edge.source, edge.target]));
      primary = primary.filter((node) => edgeEndpointIds.has(node.id));
    }
    if (normalized) {
      const matchingEdges = active.edges.filter((edge) => `${edge.label || ""} ${display(edge.details)}`.toLocaleLowerCase("zh-CN").includes(normalized));
      const edgeNodes = new Set(matchingEdges.flatMap((edge) => [edge.source, edge.target]));
      primary = primary.filter((node) => `${node.label} ${node.meta} ${node.id} ${display(node.details)}`.toLocaleLowerCase("zh-CN").includes(normalized) || edgeNodes.has(node.id));
      primaryEdges = [...new Map([...primaryEdges.filter((edge) => matchingEdges.some((match) => match.id === edge.id)), ...matchingEdges].map((edge) => [edge.id, edge])).values()];
    }
    const primaryIds = new Set(primary.map((node) => node.id));
    const visibleIds = new Set(primaryIds);
    if (!onlyMatches && (groupId || type || edgeType || edgeStatus || normalized || selectedPreset || selectedRule)) for (const edge of active.edges) {
      if (primaryIds.has(edge.source) || primaryIds.has(edge.target) || primaryEdges.some((candidate) => candidate.id === edge.id)) { visibleIds.add(edge.source); visibleIds.add(edge.target); }
    }
    if (!(groupId || type || edgeType || edgeStatus || normalized || selectedPreset || selectedRule)) active.nodes.forEach((node) => visibleIds.add(node.id));
    let nodes = active.nodes.filter((node) => visibleIds.has(node.id));
    let edges = active.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    if (selectedPreset) edges = edges.filter((edge) => presetRelations.has(String(edge.details?.关系ID || "")) || primaryIds.has(edge.source) || primaryIds.has(edge.target));
    if (selectedRule) edges = edges.filter((edge) => ruleEdges.has(edge.id) || primaryIds.has(edge.source) || primaryIds.has(edge.target));
    if (focusOnly && (selectedNodeId || selectedEdgeId)) {
      nodes = nodes.filter((node) => related.nodeIds.has(node.id));
      edges = edges.filter((edge) => related.edgeIds.has(edge.id));
    }
    return { nodes, edges, primaryCount: primary.length, primaryIds };
  }, [active, edgeStatus, edgeType, focusOnly, groupId, onlyMatches, query, related, selectedEdgeId, selectedNodeId, selectedPreset, selectedRule, type]);

  const flowNodes = useMemo<Node[]>(() => filtered.nodes.map((item) => {
    const hasSelection = Boolean(selectedNodeId || selectedEdgeId);
    const isRelated = related.nodeIds.has(item.id);
    const position = positions[active?.id || ""]?.[item.id] || { x: item.x, y: item.y };
    return {
      id: item.id, position, sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: <div className="knowledge-graph-node-copy"><span>{item.meta}</span><strong>{item.label}</strong></div> },
      className: `knowledge-graph-node tone-${item.tone}${item.meta.includes("非正式") || item.meta.includes("候选") ? " is-candidate" : ""}${Number(item.details?.应用研究数 || 0) >= 5 ? " heat-high" : Number(item.details?.应用研究数 || 0) >= 2 ? " heat-medium" : ""}${filtered.primaryIds.size && !filtered.primaryIds.has(item.id) ? " is-context" : ""}${hasSelection && isRelated ? " is-related" : ""}${hasSelection && !isRelated ? " is-dimmed" : ""}`,
      selected: item.id === selectedNodeId,
    };
  }), [active?.id, filtered.nodes, filtered.primaryIds, positions, related.nodeIds, selectedEdgeId, selectedNodeId]);
  const flowEdges = useMemo<Edge[]>(() => filtered.edges.map((item) => {
    const hasSelection = Boolean(selectedNodeId || selectedEdgeId);
    const isRelated = related.edgeIds.has(item.id);
    const tone = item.tone || "neutral";
    return {
      id: item.id, source: item.source, target: item.target, type: "smoothstep", label: item.label,
      animated: hasSelection && isRelated,
      className: `${hasSelection ? isRelated ? "is-related" : "is-dimmed" : ""}${item.dashed ? " is-dashed" : ""}`,
      style: { stroke: colors[tone], strokeWidth: hasSelection && isRelated ? 3.2 : item.usageCount ? Math.min(4, 1.3 + item.usageCount * .15) : 1.6, strokeDasharray: item.dashed ? "7 5" : undefined, opacity: hasSelection && !isRelated ? .08 : 1 },
      labelStyle: { fill: "#5c666e", fontSize: 10, opacity: hasSelection && !isRelated ? .08 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: colors[tone], width: 15, height: 15 }, zIndex: hasSelection && isRelated ? 8 : 0,
    };
  }), [filtered.edges, related.edgeIds, selectedEdgeId, selectedNodeId]);
  const selectedNode = active?.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = active?.edges.find((edge) => edge.id === selectedEdgeId);
  const directRelated = useMemo(() => {
    if (!selectedNodeId || !active) return [] as ResearchGraphNode[];
    const ids = new Set<string>();
    active.edges.forEach((edge) => { if (edge.source === selectedNodeId) ids.add(edge.target); if (edge.target === selectedNodeId) ids.add(edge.source); });
    return active.nodes.filter((node) => ids.has(node.id));
  }, [active, selectedNodeId]);
  const activeGroup = groups.find((group) => group.id === groupId);

  useEffect(() => {
    setSelectedNodeId(""); setSelectedEdgeId(""); setFocusOnly(false); setRelationDepth("1"); setPresetId(""); setRuleId(""); setQuery(""); setType(""); setEdgeType(""); setEdgeStatus(""); setOnlyMatches(false); setGroupId(active?.defaultGroup || "");
  }, [active?.defaultGroup, viewId]);
  useEffect(() => { const timer = window.setTimeout(() => instance?.fitView({ padding: .18, duration: 260 }), 80); return () => window.clearTimeout(timer); }, [edgeStatus, edgeType, focusOnly, groupId, instance, onlyMatches, presetId, query, ruleId, type, viewId]);

  function changeView(id: string) {
    setViewId(id);
    if (queryKey) { const url = new URL(window.location.href); url.searchParams.set(queryKey, id); window.history.replaceState({}, "", url); }
  }
  function onNodesChange(changes: NodeChange<Node>[]) {
    if (!active) return;
    setPositions((current) => mergeSessionNodePositions(active.id, current, changes));
  }
  function resetFilters() { setQuery(""); setType(""); setEdgeType(""); setEdgeStatus(""); setGroupId(active?.defaultGroup || ""); setPresetId(""); setRuleId(""); setSelectedNodeId(""); setSelectedEdgeId(""); setFocusOnly(false); setRelationDepth("1"); setOnlyMatches(false); }
  function resetLayout() { if (!active) return; setPositions((current) => ({ ...current, [active.id]: {} })); window.setTimeout(() => instance?.fitView({ padding: .18, duration: 240 }), 40); }
  async function toggleFullscreen() { if (!shellRef.current) return; if (document.fullscreenElement) await document.exitFullscreen(); else await shellRef.current.requestFullscreen(); }

  return <div className="knowledge-graph-shell" ref={shellRef}>
    <div className="knowledge-graph-toolbar">
      <div className="knowledge-graph-tabs" role="tablist" aria-label="图谱视图">{views.map((view) => <button className={view.id === active?.id ? "active" : ""} type="button" role="tab" aria-selected={view.id === active?.id} onClick={() => changeView(view.id)} key={view.id}>{view.label}<small>{view.hint}</small></button>)}</div>
      <div className="knowledge-graph-actions"><button type="button" onClick={() => instance?.fitView({ padding: .18, duration: 240 })}>适应画布</button><button type="button" onClick={resetLayout}>重置布局</button><button type="button" onClick={resetFilters}>清除筛选</button><button type="button" onClick={toggleFullscreen}>全屏查看</button></div>
    </div>
    <div className="knowledge-graph-explorer">
      <div className="knowledge-graph-groups" aria-label="按语义分类查看"><button className={!groupId ? "active" : ""} type="button" onClick={() => setGroupId("")}><strong>全部</strong><span>{active?.nodes.length || 0}</span></button>{groups.map((group) => <button className={groupId === group.id ? "active" : ""} title={group.description} type="button" onClick={() => setGroupId(group.id)} key={group.id}><strong>{group.label}</strong><span>{group.count}</span></button>)}</div>
      <div className="knowledge-graph-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对象或关系" aria-label="搜索图谱" /><select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选对象类型"><option value="">全部对象类型</option>{types.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select><select value={edgeType} onChange={(event) => setEdgeType(event.target.value)} aria-label="筛选关系类型"><option value="">全部关系类型</option>{edgeTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select>{edgeStatuses.length ? <select value={edgeStatus} onChange={(event) => setEdgeStatus(event.target.value)} aria-label="筛选关系状态"><option value="">全部关系状态</option>{edgeStatuses.map((item) => <option value={item} key={item}>{item === "verified" ? "已核验" : item === "planned" ? "计划关系" : item}</option>)}</select> : null}</div>
    </div>
    {active?.presets?.length || active?.rules?.length ? <div className="knowledge-graph-semantic-filters">
      {active.presets?.length ? <label>研究情景<select value={presetId} onChange={(event) => setPresetId(event.target.value)}><option value="">不限定情景</option>{active.presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label> : null}
      {active.rules?.length ? <label>规则约束<select value={ruleId} onChange={(event) => setRuleId(event.target.value)}><option value="">查看全部规则范围</option>{active.rules.map((rule) => <option value={rule.id} key={rule.id}>{rule.label}</option>)}</select></label> : null}
      {selectedPreset ? <span>{selectedPreset.description} · 进入条件 {selectedPreset.entryConditions.length} 项 · 完成条件 {selectedPreset.completionConditions.length} 项</span> : selectedRule ? <span>{selectedRule.description}</span> : <span>情景用于限定需要的对象和关系；规则用于定位其实际约束范围。</span>}
    </div> : null}
    <div className="knowledge-graph-caption"><div><strong>{activeGroup?.label || active?.label}</strong><span>{activeGroup?.description || active?.hint}</span></div><b>{groupId || type || edgeType || edgeStatus || query || presetId || ruleId ? `${filtered.primaryCount} 个匹配 · ${filtered.nodes.length} 个含关联上下文` : `${filtered.nodes.length} 个节点`} · {filtered.edges.length} 条关系</b><label className="knowledge-only-matches"><input type="checkbox" checked={onlyMatches} onChange={(event) => setOnlyMatches(event.target.checked)} />只看匹配项</label></div>
    <div className={`knowledge-graph-contextbar${selectedNode || selectedEdge ? " has-selection" : ""}`}>
      {selectedNode ? <><span>当前对象</span><strong>{selectedNode.label}</strong><span>高亮 {Math.max(0, related.nodeIds.size - 1)} 个相关对象</span><label>关系范围<select value={relationDepth} onChange={(event) => setRelationDepth(event.target.value as RelationDepth)}><option value="1">直接相关</option><option value="2">两层关系</option><option value="all">完整关联链</option></select></label><button className={focusOnly ? "active" : ""} type="button" onClick={() => setFocusOnly((value) => !value)}>{focusOnly ? "返回全部" : "只看相关"}</button></> : selectedEdge ? <><span>当前关系</span><strong>{selectedEdge.label}</strong><span>已高亮关系两端对象</span><button className={focusOnly ? "active" : ""} type="button" onClick={() => setFocusOnly((value) => !value)}>{focusOnly ? "返回全部" : "只看这条关系"}</button></> : <><strong>如何阅读：</strong><span>先按分类或情景缩小范围；点击对象查看关联网络，点击连线查看关系定义。</span></>}
    </div>
    <div className="knowledge-graph-canvas">{flowNodes.length ? <ReactFlow nodes={flowNodes} edges={flowEdges} onNodesChange={onNodesChange} onInit={setInstance} onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(""); setFocusOnly(false); }} onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(""); setFocusOnly(false); }} onPaneClick={() => { setSelectedNodeId(""); setSelectedEdgeId(""); setFocusOnly(false); }} nodesConnectable={false} nodesDraggable fitView fitViewOptions={{ padding: .18 }} minZoom={.2} maxZoom={2}><Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d8e0df" /><Controls showInteractive={false} /></ReactFlow> : <div className="knowledge-graph-empty"><strong>当前筛选没有结果</strong><span>{active?.emptyMessage || "请清除部分筛选条件后重试"}</span><button type="button" onClick={resetFilters}>清除筛选</button></div>}</div>
    <div className="knowledge-graph-legend"><span className="formal">正式知识</span><span className="candidate">任务候选/计划关系</span><span className="applied">已应用/高频</span><span>高亮线表示当前关联</span></div>
    {selectedNode || selectedEdge ? <aside className="knowledge-graph-drawer"><button className="knowledge-graph-drawer-close" type="button" onClick={() => { setSelectedNodeId(""); setSelectedEdgeId(""); setFocusOnly(false); }} aria-label="关闭详情">×</button><span className="eyebrow">{selectedEdge ? "当前选中关系" : "当前选中对象"}</span><h2>{selectedEdge?.label || selectedNode?.label}</h2><code>{selectedEdge?.id || selectedNode?.id}</code>{selectedNode ? <span className="badge">{selectedNode.meta}</span> : null}
      {selectedNode ? <><div className="knowledge-related-summary"><strong>{directRelated.length} 个直接关联</strong><button type="button" onClick={() => setFocusOnly(true)}>只在画布中查看</button></div>{directRelated.length ? <div className="knowledge-related-list">{directRelated.slice(0, 16).map((node) => <button type="button" onClick={() => { setSelectedNodeId(node.id); setFocusOnly(false); }} key={node.id}><span>{node.meta}</span><strong>{node.label}</strong></button>)}</div> : <p className="muted">当前对象没有显式直接关系。</p>}</> : <div className="knowledge-edge-endpoints"><button type="button" onClick={() => { setSelectedNodeId(selectedEdge?.source || ""); setSelectedEdgeId(""); }}>源对象：{active?.nodes.find((node) => node.id === selectedEdge?.source)?.label}</button><button type="button" onClick={() => { setSelectedNodeId(selectedEdge?.target || ""); setSelectedEdgeId(""); }}>目标对象：{active?.nodes.find((node) => node.id === selectedEdge?.target)?.label}</button></div>}
      <details open><summary>定义、来源与属性</summary><dl>{Object.entries(selectedEdge?.details || selectedNode?.details || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value)}</dd></div>)}</dl></details></aside> : null}
  </div>;
}
