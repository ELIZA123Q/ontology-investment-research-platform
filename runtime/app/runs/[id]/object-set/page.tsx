import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { ObjectSetPanel } from "@/app/components/object-set-panel";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildEntityRelationGraph } from "@/app/lib/entity-relation-graph";
import { authorityLabel } from "@/app/lib/ui-labels";
import { loadGraphForRun } from "@/engine/instance_graph";

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
      <div className="pagehead scene-head">
        <div>
          <div className="eyebrow">关系图（实体 ER）</div>
          <h1>本轮业务实体与关系</h1>
          <p className="muted">
            节点 {graph.nodes.length} · 关系 {graph.edges.length} · {authorityLabel(loaded.authority)}
          </p>
        </div>
        <div className="actions">
          <Link className="button-secondary" href={`/runs/${id}/object-set?view=graph${includeProcess ? "&includeProcess=1" : ""}`}>ER 视图</Link>
          <Link className="button-secondary" href={`/runs/${id}/object-set?view=ops`}>对象操作</Link>
          <Link className="button-secondary" href={`/ontology?runId=${id}`}>查看本体网络</Link>
          <Link className="button-secondary" href={`/runs/${id}/object-set?view=${view}&includeProcess=${includeProcess ? "0" : "1"}`}>
            {includeProcess ? "隐藏研究过程对象" : "显示研究过程对象"}
          </Link>
        </div>
      </div>
      {view === "ops" ? (
        <ObjectSetPanel runId={id} />
      ) : (
        <ResearchGraphLazy
          nodes={graph.nodes}
          edges={graph.edges}
          emptyMessage="当前研究尚无可展示的实体关系"
        />
      )}
    </>
  );
}
