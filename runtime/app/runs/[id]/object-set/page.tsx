import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/storage/db";
import { latestArtifactPayload } from "@/storage/db_read_models";
import { listVariableUsageQueries } from "@/skills/ontology/research_queries";
import { JudgmentRelationAuditPanel } from "@/app/components/judgment-relation-audit";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildLayeredEntityNetwork, entityLayerTypes, type EntityNetworkLayer } from "@/app/lib/entity-relation-graph";
import { authorityLabel, objectTypeLabel } from "@/app/lib/ui-labels";
import { loadGraphForRun } from "@/skills/ontology/instance_graph";
import { formalStateVariableDisplayNames } from "@/skills/ontology/display_labels";
import { buildOntologyStructureReview } from "@/skills/ontology/structure_review";
import { parseJson } from "@/schemas/types";
import { ReferenceSceneChrome } from "@/app/components/stage-scene-chrome";

export const dynamic = "force-dynamic";

const LAYERS: Array<{ id: EntityNetworkLayer; label: string; note: string }> = [
  { id: "business", label: "业务实体与变量", note: "公司、产品、行业、区域、技术和状态变量" },
  { id: "evidence", label: "证据链", note: "来源、事实、证据要求与信号" },
  { id: "reasoning", label: "判断链", note: "范围、判断单元、假设、规则和结论" },
  { id: "technical", label: "方法与留痕", note: "方法应用和推理留痕" },
];

function normalizeView(value?: string) {
  if (value === "entities" || value === "ops") return "entities" as const;
  return "judgments" as const;
}
export default async function ObjectSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; filter?: string; layer?: string | string[]; q?: string; type?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const run = getRun(id);
  if (!run) notFound();
  const loaded = loadGraphForRun(id, run.package_path);
  const view = normalizeView(q.view);
  const structure = parseJson<Record<string, any>>(
    latestArtifactPayload(id, "stage_02", ["approved", "needs_review"])?.json_content || "{}",
    {},
  );
  const evidence = parseJson<Record<string, any>>(
    latestArtifactPayload(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}",
    {},
  );
  const judgment = parseJson<Record<string, any>>(
    latestArtifactPayload(id, "stage_04", ["approved", "needs_review"])?.json_content || "{}",
    {},
  );
  const structureReview = buildOntologyStructureReview({
    runId: id,
    structure,
    evidence,
    judgment,
    graph: loaded.graph,
    formalStateVariables: formalStateVariableDisplayNames(),
    variableUsages: listVariableUsageQueries(),
  });
  const audits = structureReview.audits;
  const rawLayers = Array.isArray(q.layer) ? q.layer : q.layer ? [q.layer] : ["business"];
  const layers = rawLayers.filter((layer): layer is EntityNetworkLayer => LAYERS.some((item) => item.id === layer));
  if (!layers.length) layers.push("business");
  const entityGraph = buildLayeredEntityNetwork(loaded, { layers, query: q.q, type: q.type });
  const availableTypes = [...new Set(layers.flatMap(entityLayerTypes))]
    .filter((type) => loaded.graph.objects.some((object) => object.type === type))
    .sort((left, right) => objectTypeLabel(left).localeCompare(objectTypeLabel(right), "zh-CN"));
  const problemCount = audits.filter((audit) => audit.status !== "complete").length;
  const candidateGovernanceActions = structureReview.recommended_actions
    .filter((item) => item.repair_stage === "ontology");

  return <>
    <ReferenceSceneChrome
      sceneId="object-set"
      hintOverride={view === "judgments"
        ? `按 ${audits.length} 项判断核对正式范围、证据和推理链；其中 ${problemCount} 项需要关注 · ${authorityLabel(loaded.authority)}`
        : `默认只展示业务实体与状态变量；按需展开证据、判断和方法图层 · ${authorityLabel(loaded.authority)}`}
      actions={<>
        <Link className={view === "judgments" ? "button" : "button-secondary"} href={`/runs/${id}/object-set?view=judgments`}>判断链审计</Link>
        <Link className={view === "entities" ? "button" : "button-secondary"} href={`/runs/${id}/object-set?view=entities`}>实体网络（高级）</Link>
        <Link className="button-quiet" href={`/ontology?tab=network&runId=${id}`}>查看知识定义</Link>
      </>}
    />

    {loaded.authority === "empty" || loaded.provisional ? <div className="notice warning">
      当前阶段可能已有结构化内容，但尚未形成正式实例关系；本页不会按名称猜测或补画连接。
    </div> : null}

    {view === "judgments" ? (<>
      {candidateGovernanceActions.length ? <section className="card relation-governance-actions">
        <div><span>知识缺口治理</span><strong>重复出现的任务内候选不再逐任务复制</strong></div>
        {candidateGovernanceActions.map((action) => <Link key={`${action.code}:${action.target_id}`} href={`/ontology?tab=governance&runId=${encodeURIComponent(id)}`}>
          <strong>{action.title}</strong><small>{action.detail}</small>
        </Link>)}
      </section> : null}
      <JudgmentRelationAuditPanel runId={id} audits={audits} problemsOnly={q.filter === "problems"} />
    </>
    ) : <>
      <section className="entity-network-toolbar" aria-label="实体网络筛选">
        <form method="get">
          <input type="hidden" name="view" value="entities" />
          <div className="entity-layer-options">
            {LAYERS.map((layer) => <label key={layer.id}>
              <input type="checkbox" name="layer" value={layer.id} defaultChecked={layers.includes(layer.id)} />
              <span><strong>{layer.label}</strong><small>{layer.note}</small></span>
            </label>)}
          </div>
          <div className="entity-network-search">
            <label><span>搜索对象</span><input name="q" defaultValue={q.q || ""} placeholder="输入公司、产品、变量或对象编号" /></label>
            <label><span>对象类型</span><select name="type" defaultValue={q.type || ""}><option value="">全部类型</option>{availableTypes.map((type) => <option key={type} value={type}>{objectTypeLabel(type)}</option>)}</select></label>
            <button className="button" type="submit">更新网络</button>
            {(q.q || q.type || layers.length > 1) ? <Link className="button-quiet" href={`/runs/${id}/object-set?view=entities`}>重置</Link> : null}
          </div>
        </form>
        <div className="entity-network-metrics">
          <span>当前显示 <strong>{entityGraph.nodes.length}</strong> 个对象</span>
          <span><strong>{entityGraph.edges.length}</strong> 条直接关系</span>
          <small>点击节点后只高亮相邻对象和连接；技术编号收在节点详情中。</small>
        </div>
      </section>
      <ResearchGraphLazy nodes={entityGraph.nodes} edges={entityGraph.edges} emptyMessage="当前筛选条件下没有可展示的正式实体关系；可清除搜索或展开其他图层。" />
    </>}
  </>;
}
