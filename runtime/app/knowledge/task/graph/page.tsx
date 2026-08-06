import Link from "next/link";
import { KnowledgeGraphWorkspace, type KnowledgeGraphView } from "@/app/components/knowledge-graph-workspace";
import { KnowledgeRunSelector } from "@/app/components/knowledge-run-selector";
import { buildBusinessEntityGraph, buildReasoningPathGraph } from "@/app/lib/entity-relation-graph";
import { addTaskLocalCandidatesToOntologyGraph, buildOntologyNetworkGraph, selectRelevantOntologyNodes } from "@/app/lib/ontology-network-graph";
import { loadTaskKnowledgePage } from "@/app/lib/knowledge-page-data";
import { runStatusLabel, stageLabel } from "@/app/lib/ui-labels";
import { parseJson } from "@/schemas/types";

export const dynamic = "force-dynamic";

export default async function TaskKnowledgeGraphPage({ searchParams }: { searchParams: Promise<{ runId?: string; graph?: string }> }) {
  const query = await searchParams;
  const { runs, selectedRun, dashboard, ontologyNodes } = loadTaskKnowledgePage(query.runId);
  const requestedGraph = ["entities", "reasoning", "ontology"].includes(String(query.graph)) ? String(query.graph) : "entities";
  const manifest = selectedRun ? parseJson<Record<string, any>>(selectedRun.manifest_json, {}) : {};
  const scenarioId = String(manifest.scenario_type || manifest.research_scenario?.scenario_type || "");
  const scenario = ontologyNodes.find((node) => node.category === "Scenario" && node.id === scenarioId);
  let views: KnowledgeGraphView[] = [];
  if (dashboard) {
    const entities = buildBusinessEntityGraph(dashboard.loadedGraph);
    const reasoning = buildReasoningPathGraph(dashboard.loadedGraph);
    const relevantBase = selectRelevantOntologyNodes(ontologyNodes, dashboard.formalOntologyIds);
    const relevant = [...relevantBase, ...ontologyNodes.filter((node) => node.category === "Scenario" && !relevantBase.some((item) => item.id === node.id))];
    const ontology = addTaskLocalCandidatesToOntologyGraph(buildOntologyNetworkGraph(relevant, dashboard.formalOntologyIds), dashboard.localCandidates);
    views = [
      { id: "entities", label: "实体关系图", hint: "研究对象是谁，它们如何连接", groupMode: "entity", nodes: entities.nodes, edges: entities.edges, emptyMessage: "本研究还没有形成业务实体关系" },
      { id: "reasoning", label: "推理路径图", hint: "信号与假设如何形成判断", groupMode: "reasoning", nodes: reasoning.nodes, edges: reasoning.edges, emptyMessage: "本研究还没有形成可展示的推理路径" },
      { id: "ontology", label: "应用本体图", hint: "本研究采用了哪些正式知识与任务候选", groupMode: "ontology", nodes: ontology.nodes, edges: ontology.edges, presets: ontology.presets, rules: ontology.rules, emptyMessage: "本研究还没有触及可展示的本体知识" },
    ];
  }
  return <section className="knowledge-task-page">
    <KnowledgeRunSelector runs={runs} selectedRun={selectedRun} action="/knowledge/task/graph"><span className="knowledge-question-help">本页回答：研究了谁？依据什么？怎样形成判断？用了哪些本体？</span></KnowledgeRunSelector>
    {dashboard && selectedRun ? <>
      <section className="knowledge-usage-summary" aria-label="本研究知识摘要"><article><span>研究进度</span><strong>{stageLabel(selectedRun.current_stage)}</strong><small>{runStatusLabel(selectedRun.status)}</small></article><article><span>知识实例</span><strong>{dashboard.loadedGraph.graph.objects.length}</strong><small>含对象、证据与判断实例</small></article><article><span>实例关系</span><strong>{dashboard.loadedGraph.graph.relations.length}</strong><small>实例之间的显式连线</small></article><article><span>正式知识</span><strong>{dashboard.formalOntologyIds.length}</strong><small>只统计实际触及</small></article><article><span>任务专用候选</span><strong>{dashboard.localCandidates.length}</strong><small>尚未进入正式本体</small></article><article><span>研究方法</span><strong>{dashboard.methods.length}</strong><small>详情在实际使用页</small></article></section>
      <section className="knowledge-section-block"><div className="knowledge-block-heading"><div><span className="knowledge-step-kicker">先选择要回答的问题</span><h2>一张图只表达一种关系</h2><p>实体图解释研究对象，推理图解释判断形成过程，应用本体图解释采用的类型、Link 和约束。节点可自由拖动，点击对象或连线查看关联。</p><span className="knowledge-scenario-note">研究情景：{scenario?.name || (scenarioId ? scenarioId : "当前研究未登记正式情景，可在应用本体图中使用情景预设辅助查看")}</span></div><div className="knowledge-heading-actions"><Link href={`/knowledge/task/applications?runId=${selectedRun.id}`}>核对实际知识使用 →</Link><Link href={`/runs/${selectedRun.id}`}>返回研究工作台 →</Link></div></div><KnowledgeGraphWorkspace views={views} initialView={requestedGraph} queryKey="graph" /></section>
    </> : <div className="knowledge-selection-empty"><strong>创建研究后，这里会展示实体、推理路径与应用本体。</strong></div>}
  </section>;
}
