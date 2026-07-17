import Link from "next/link";
import { loadOntology, ontologyInstances } from "@/adapters/ontology";
import { listRuns } from "@/adapters/db";

export const dynamic = "force-dynamic";

export default async function OntologyPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; runId?: string }>;
}) {
  const q = await searchParams;
  const nodes = loadOntology();
  const selected = nodes.find((n) => n.id === q.node) || nodes[0];
  const runs = listRuns();
  const runId = q.runId || runs[0]?.id;
  const linked = selected && runId
    ? ontologyInstances(selected.id, runId)
    : { instances: [] as any[], sources: [] as Array<{ id: string; url: string; title: string }>, graph_source: "", executable_actions: [] as string[] };
  const groups = Object.groupBy(nodes, (n) => n.category);

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Ontology browser</div>
          <h1>知识资产与运行实例</h1>
          <p className="muted">只读浏览正式 YAML；实例来自 business_instance_graph Object Set。</p>
        </div>
        <form>
          <input type="hidden" name="node" value={selected?.id} />
          <select name="runId" defaultValue={runId} onChange={undefined}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.question.slice(0, 36)}
              </option>
            ))}
          </select>
          <button className="button-secondary">切换运行</button>
        </form>
      </div>
      <div className="three-col">
        <aside className="card ontology-list">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <h3>{group}</h3>
              {items?.map((n) => (
                <Link
                  className={n.id === selected?.id ? "active" : ""}
                  href={`/ontology?node=${encodeURIComponent(n.id)}${runId ? `&runId=${runId}` : ""}`}
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
                  <h3>write_scope</h3>
                  <p>{selected.write_scope.join("、")}</p>
                </>
              ) : null}
              {selected.function_ref ? (
                <>
                  <h3>function_ref</h3>
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
            </>
          )}
        </section>
        <section className="card">
          <h2>当前运行实例</h2>
          {"graph_source" in linked && linked.graph_source ? (
            <p className="muted">图来源：{String((linked as any).graph_source)}</p>
          ) : null}
          {"executable_actions" in linked && (linked as any).executable_actions?.length ? (
            <p className="muted">相关 Action：{(linked as any).executable_actions.join("、")}</p>
          ) : null}
          {linked.instances.length ? (
            linked.instances.map((x: any, i: number) => (
              <div key={`${x.artifact_id}-${i}`} style={{ marginBottom: 12 }}>
                <strong>{x.label}</strong>
                <br />
                <small>
                  {x.object?.type || x.kind} · {x.path}
                </small>
              </div>
            ))
          ) : (
            <p className="muted">当前运行尚无关联实例。可在创建运行时绑定正式样例包。</p>
          )}
          {linked.sources.length > 0 && (
            <>
              <h3>关联来源</h3>
              <ul className="source-list">
                {linked.sources.map((s) => (
                  <li key={s.id}>
                    <a href={s.url}>{s.title}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
