import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { ObjectSetPanel } from "@/app/components/object-set-panel";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildEntityRelationGraph } from "@/app/lib/entity-relation-graph";
import { authorityLabel } from "@/app/lib/ui-labels";
import { loadGraphForRun } from "@/engine/instance_graph";
import { ReferenceSceneChrome } from "@/app/components/stage-scene-chrome";

export const dynamic = "force-dynamic";

export default async function ObjectSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const run = getRun(id);
  if (!run) notFound();
  const loaded = loadGraphForRun(id, run.package_path);
  const graph = buildEntityRelationGraph(loaded, { scope: "decision" });
  const view = q.view || "graph";
  const hasBindingGap = graph.stats.judgmentUnitsWithoutVariableBindings > 0 || graph.stats.unboundStateVariables > 0;
  return (
    <>
      <ReferenceSceneChrome
        sceneId="object-set"
        hintOverride={`主链显示 ${graph.nodes.length} 个已连接对象、${graph.edges.length} 条直接关系 · ${authorityLabel(loaded.authority)}`}
        actions={
          <>
            <Link className={view === "graph" ? "button" : "button-secondary"} href={`/runs/${id}/object-set?view=graph`}>查看实例主链</Link>
            <Link className={view === "ops" ? "button" : "button-secondary"} href={`/runs/${id}/object-set?view=ops`}>查询全部对象</Link>
            <Link className="button-secondary" href={`/ontology?tab=network&runId=${id}`}>查看知识定义</Link>
          </>
        }
      />
      {view === "ops" ? (
        <ObjectSetPanel runId={id} />
      ) : <>
        <section className="object-graph-purpose" aria-label="实例关系图用途与完整性">
          <article>
            <span>本页看什么</span>
            <strong>本轮具体对象如何连接</strong>
            <p>只画正式实例关系；不展示知识类型和规则定义，也不根据名称猜测关系。</p>
          </article>
          <article>
            <span>与知识库的区别</span>
            <strong>实例链路 ≠ 知识定义</strong>
            <p>知识库回答“允许怎样连接”；本页回答“这轮实际连接了什么”。</p>
          </article>
          <article>
            <span>正式图规模</span>
            <strong>{graph.stats.totalObjects} 个对象 · {graph.stats.totalRelations} 条关系</strong>
            <p>主链只保留与研究问题、范围、假设和判断直接相关的关系。</p>
          </article>
        </section>
        {hasBindingGap ? <div className="notice warning object-graph-warning">
          <strong>关系完整性提示：</strong>
          {graph.stats.judgmentUnitsWithoutVariableBindings} / {graph.stats.judgmentUnits} 个判断单元尚未正式绑定状态变量，
          {graph.stats.unboundStateVariables} / {graph.stats.stateVariables} 个状态变量因此未进入主链。
          另有 {graph.stats.isolatedDecisionObjects} 个决策对象没有任何主链关系，已从画布隐藏。
          这是本轮结构数据缺口，不是前端漏线；系统不会用文本相似度补画。请在后续结构修订中为路径填写明确的 judgment_unit_ids。
        </div> : null}
        {graph.edges.length ? (
          <ResearchGraphLazy
            nodes={graph.nodes}
            edges={graph.edges}
            emptyMessage="当前研究尚无可展示的实例主链"
          />
        ) : <section className="card entity-inventory">
          <div className="section-heading">
            <div><div className="eyebrow">关系完整性</div><h2>已识别对象，但尚未形成可展示的实例主链</h2></div>
            <span className="badge">{graph.stats.totalObjects} 个对象</span>
          </div>
          <p className="muted">孤立节点不能回答影响路径，因此不绘制空关系图。需要核对单个对象时使用“查询全部对象”；需要查看知识类型与规则时使用“查看知识定义”。</p>
        </section>}
      </>}
    </>
  );
}
