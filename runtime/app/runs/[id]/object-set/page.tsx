import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { ObjectSetPanel } from "@/app/components/object-set-panel";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildEntityRelationGraph } from "@/app/lib/entity-relation-graph";
import { authorityLabel, objectTypeLabel } from "@/app/lib/ui-labels";
import { loadGraphForRun } from "@/engine/instance_graph";
import { ReferenceSceneChrome } from "@/app/components/stage-scene-chrome";

export const dynamic = "force-dynamic";

export default async function ObjectSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; includeProcess?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const run = getRun(id);
  if (!run) notFound();
  const includeProcess = q.includeProcess === "1";
  const loaded = loadGraphForRun(id, run.package_path);
  const graph = buildEntityRelationGraph(loaded, { includeProcessObjects: includeProcess });
  const view = q.view || "graph";
  return (
    <>
      <ReferenceSceneChrome
        sceneId="object-set"
        hintOverride={`已识别 ${graph.nodes.length} 个业务对象、${graph.edges.length} 条可展示关系 · ${authorityLabel(loaded.authority)}`}
        actions={
          <>
            <Link className={view === "graph" ? "button" : "button-secondary"} href={`/runs/${id}/object-set?view=graph${includeProcess ? "&includeProcess=1" : ""}`}>查看关系</Link>
            <Link className={view === "ops" ? "button" : "button-secondary"} href={`/runs/${id}/object-set?view=ops`}>查询对象</Link>
            <Link className="button-secondary" href={`/ontology?runId=${id}`}>查看知识作用</Link>
            <details className="toolbar-more object-graph-options">
              <summary>显示范围</summary>
              <Link className="button-quiet" href={`/runs/${id}/object-set?view=${view}&includeProcess=${includeProcess ? "0" : "1"}`}>
                {includeProcess ? "只看业务对象" : "同时显示研究过程对象"}
              </Link>
            </details>
          </>
        }
      />
      {view === "ops" ? (
        <ObjectSetPanel runId={id} />
      ) : graph.edges.length ? (
        <ResearchGraphLazy
          nodes={graph.nodes}
          edges={graph.edges}
          emptyMessage="当前研究尚无可展示的实体关系"
        />
      ) : <section className="card entity-inventory">
        <div className="section-heading">
          <div><div className="eyebrow">当前可用信息</div><h2>已识别对象，但尚未形成可展示的业务关系</h2></div>
          <span className="badge">{graph.nodes.length} 个对象</span>
        </div>
        <p className="muted">孤立节点不能回答影响路径，因此不绘制空关系图。需要核对单个对象时使用“查询对象”；需要查看研究逻辑时返回结构、证据或判断页面。</p>
        <div className="entity-inventory-list">
          {graph.nodes.slice(0, 16).map((node) => <span key={node.id}><small>{objectTypeLabel(node.meta)}</small>{node.label}</span>)}
        </div>
      </section>}
    </>
  );
}
