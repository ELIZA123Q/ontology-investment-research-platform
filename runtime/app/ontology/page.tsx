import Link from "next/link";
import { loadOntology, ontologyInstances } from "@/adapters/ontology";
import { listRuns } from "@/adapters/db";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildOntologyNetworkGraph, selectRelevantOntologyNodes } from "@/app/lib/ontology-network-graph";
import { collectRunOntologyTouchpoints, getRunOntologyResearchValue, listKnowledgeAssets } from "@/engine/knowledge_browser";
import type { OntologyResearchEffectKind } from "@/engine/ontology_research_value";

export const dynamic = "force-dynamic";

export default async function OntologyPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; runId?: string; tab?: string; scope?: string }>;
}) {
  const q = await searchParams;
  const nodes = loadOntology();
  const selected = nodes.find((n) => n.id === q.node) || nodes[0];
  const runs = listRuns();
  const runId = q.runId || runs.find((run) => run.status !== "archived")?.id || runs[0]?.id;
  const tab = q.tab || "network";
  const touched = runId ? collectRunOntologyTouchpoints(runId) : [];
  const ontologyValue = runId ? getRunOntologyResearchValue(runId) : null;
  const allRelevantIds = [...new Set([...touched, ...(ontologyValue?.relevant_node_ids || [])])];
  const showFullNetwork = q.scope === "all" || !runId;
  const visibleNodes = showFullNetwork ? nodes : selectRelevantOntologyNodes(nodes, allRelevantIds);
  const network = buildOntologyNetworkGraph(visibleNodes, allRelevantIds);
  const assets = listKnowledgeAssets();
  const linked = selected && runId
    ? ontologyInstances(selected.id, runId)
    : { instances: [] as any[], sources: [] as Array<{ id: string; url: string; title: string }>, graph_source: "", executable_actions: [] as string[] };
  const groups = Object.groupBy(nodes, (n) => n.category);
  const effectKinds: Array<{ kind: OntologyResearchEffectKind; label: string; description: string }> = [
    { kind: "completion", label: "补全", description: "标准口径与可复用身份" },
    { kind: "constraint", label: "限制", description: "阻止牵强映射与越级判断" },
    { kind: "connection", label: "关联", description: "形成影响查询与局部重算路径" },
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">知识库</div>
          <h1>本体网络与方法规范</h1>
          <p className="muted">跨研究复用的知识资产：本体类型网络、定义目录与各阶段规范。</p>
        </div>
        <form>
          <input type="hidden" name="node" value={selected?.id || ""} />
          <input type="hidden" name="tab" value={tab} />
          <select name="runId" defaultValue={runId} onChange={undefined}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.question.slice(0, 36)}
              </option>
            ))}
          </select>
          <button className="button-secondary">切换高亮研究</button>
        </form>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="actions">
          <Link className={`button-secondary${tab === "network" ? " active" : ""}`} href={`/ontology?tab=network${runId ? `&runId=${runId}` : ""}`}>本体网络</Link>
          <Link className={`button-secondary${tab === "catalog" ? " active" : ""}`} href={`/ontology?tab=catalog${runId ? `&runId=${runId}` : ""}`}>类型目录</Link>
          <Link className={`button-secondary${tab === "methods" ? " active" : ""}`} href={`/ontology?tab=methods${runId ? `&runId=${runId}` : ""}`}>方法与规范</Link>
        </div>
      </div>
      {runId && ontologyValue ? (
        <section className="card ontology-value-summary">
          <div className="section-heading">
            <div>
              <div className="eyebrow">本体在本研究中做了什么</div>
              <h2>不是展示节点，而是补全口径、限制越界并连接影响路径</h2>
            </div>
            <span className="badge">{ontologyValue.effects.length} 项可追溯作用</span>
          </div>
          <div className="ontology-value-grid">
            {effectKinds.map(({ kind, label, description }) => {
              const effects = ontologyValue.effects.filter((effect) => effect.kind === kind);
              return (
                <article className={`ontology-value-column ${kind}`} key={kind}>
                  <div className="ontology-value-column-head">
                    <strong>{label} · {effects.length}</strong>
                    <span>{description}</span>
                  </div>
                  {effects.slice(0, 4).map((effect) => (
                    <details key={effect.id}>
                      <summary>{effect.title}</summary>
                      <p>{effect.explanation}</p>
                      <small>{effect.result}</small>
                    </details>
                  ))}
                  {!effects.length ? <p className="muted">当前阶段尚无可核验记录</p> : null}
                  {effects.length > 4 ? <p className="muted">另有 {effects.length - 4} 项，可在对象关系与审计产物中追溯。</p> : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {tab === "network" ? (
        <>
          <div className="card ontology-network-scope">
            <div>
              <strong>{showFullNetwork ? "完整本体网络（高级视图）" : "本研究相关子图"}</strong>
              <p className="muted">
                当前显示 {visibleNodes.length}/{nodes.length} 个类型、关系与规则节点。
                {showFullNetwork ? "完整网络用于治理与排查。" : "默认只保留本轮触及节点及一跳关系端点。"}
              </p>
            </div>
            {runId ? (
              <Link
                className="button-secondary"
                href={`/ontology?tab=network&runId=${runId}${showFullNetwork ? "" : "&scope=all"}`}
              >
                {showFullNetwork ? "返回任务子图" : "查看完整网络（高级）"}
              </Link>
            ) : null}
          </div>
          <ResearchGraphLazy nodes={network.nodes} edges={network.edges} emptyMessage="当前研究尚未触及可展示的本体节点" />
        </>
      ) : null}
      {tab === "catalog" ? (
        <div className="three-col">
        <aside className="card ontology-list">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <h3>{group}</h3>
              {items?.map((n) => (
                <Link
                  className={n.id === selected?.id ? "active" : ""}
                  href={`/ontology?tab=catalog&node=${encodeURIComponent(n.id)}${runId ? `&runId=${runId}` : ""}`}
                  key={n.id}
                >
                  {n.name}
                  <small className="muted"> · {n.id}</small>
                </Link>
              ))}
            </div>
          ))}
        </aside>
        <section className="card">
          {selected && (
            <>
              <span className="badge">{selected.category}</span>
              <h1>{selected.name}</h1>
              <code>{selected.id}</code>
              <p>{selected.description || "暂无说明"}</p>
              <h3>属性</h3>
              <p>{selected.properties.join("、") || "无"}</p>
              {selected.write_scope?.length ? (
                <>
                  <h3>可写范围</h3>
                  <p>{selected.write_scope.join("、")}</p>
                </>
              ) : null}
              {selected.function_ref ? (
                <>
                  <h3>关联函数</h3>
                  <p>{selected.function_ref}</p>
                </>
              ) : null}
              <h3>关系端点</h3>
              <p>
                来源：{selected.source_types.join("、") || "—"}
                <br />
                目标：{selected.target_types.join("、") || "—"}
              </p>
              <p className="muted">{selected.source_file}</p>
              {runId ? (
                <div className="ontology-run-instances">
                  <h3>本研究中的对应实例</h3>
                  {linked.instances.length ? (
                    <ul className="source-list">
                      {linked.instances.slice(0, 8).map((instance: any) => (
                        <li key={instance.object.id}>
                          <strong>{instance.label}</strong>
                          <small className="muted"> · {instance.object.id}</small>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">本轮尚无该类型的实例，不能仅因类型存在就声称已用于研究。</p>}
                  <p className="muted">可执行操作：{linked.executable_actions.join("、") || "暂无"}</p>
                </div>
              ) : null}
            </>
          )}
        </section>
        </div>
      ) : null}
      {tab === "methods" ? (
        <section className="card">
          <h2>方法与规范资产</h2>
          <p className="muted">来源：runtime_contexts.yaml（模型运行时注入资产）</p>
          <div className="artifact-ledger">
            {assets.map((asset) => (
              <details key={`${asset.stage}:${asset.file}`} style={{ marginBottom: 10 }}>
                <summary><strong>{asset.stage}</strong> · {asset.title}</summary>
                <p className="muted">{asset.file}</p>
                <pre className="json-editor" style={{ whiteSpace: "pre-wrap" }}>{asset.snippet}</pre>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
