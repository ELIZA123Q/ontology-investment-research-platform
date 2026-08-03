import { KnowledgeGraphWorkspace } from "@/app/components/knowledge-graph-workspace";
import { KnowledgeLibrarySummary } from "@/app/components/knowledge-library-summary";
import { loadLibraryKnowledgePage } from "@/app/lib/knowledge-page-data";

export const dynamic = "force-dynamic";

export default async function KnowledgeLibraryMapPage({ searchParams }: { searchParams: Promise<{ layer?: string }> }) {
  const query = await searchParams;
  const data = loadLibraryKnowledgePage();
  const initial = ["structure", "heat", "gaps"].includes(String(query.layer)) ? String(query.layer) : "structure";
  return <section className="knowledge-library-page"><KnowledgeLibrarySummary data={{ objectCount: data.catalog.object_types.size, relationCount: data.catalog.relation_types.size, ruleCount: data.catalog.rules.size, runCount: data.runs.length, candidateCount: data.candidates.length, repeatedCount: data.repeatedCandidates.length, fingerprint: data.catalog.fingerprint, legacyRunCount: data.affectedLegacyRuns.length }} />
    <section className="knowledge-section-block"><div className="knowledge-block-heading"><div><span className="knowledge-step-kicker">本页回答：知识库描述什么，以及如何连接</span><h2>整体知识地图</h2><p>对象类型是节点，Link 类型是连线；规则只标注其约束范围，研究情景用于快速切换需要的对象和关系。默认从核心业务开始，按需扩展到完整本体。</p></div></div><KnowledgeGraphWorkspace views={[
      { id: "structure", label: "知识结构", hint: "对象和 Link 如何组成知识库", groupMode: "ontology", defaultGroup: "core", nodes: data.fullOntologyGraph.nodes, edges: data.fullOntologyGraph.edges, presets: data.fullOntologyGraph.presets, rules: data.fullOntologyGraph.rules },
      { id: "heat", label: "应用热度", hint: "哪些对象和 Link 被更多研究采用", groupMode: "ontology", defaultGroup: "core", nodes: data.heatGraph.nodes, edges: data.heatGraph.edges, presets: data.heatGraph.presets, rules: data.heatGraph.rules },
      { id: "gaps", label: "缺口候选", hint: "哪些任务概念可能值得正式入库", groupMode: "candidate", nodes: data.gapGraph.nodes, edges: data.gapGraph.edges, emptyMessage: "当前没有非正式本体候选" },
    ]} initialView={initial} queryKey="layer" /></section>
  </section>;
}
