import Link from "next/link";
import { loadOntology, ontologyInstances } from "@/adapters/ontology";
import { listArtifacts, listRuns } from "@/adapters/db";
import { listCrossRunVariableComparability } from "@/adapters/variable_comparability";
import { listEvidenceImpactQueries, listVariableUsageQueries } from "@/adapters/ontology_research_queries";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { OntologyCandidateQueue } from "@/app/components/ontology-candidate-queue";
import { buildOntologyNetworkGraph, selectRelevantOntologyNodes } from "@/app/lib/ontology-network-graph";
import { collectRunOntologyTouchpoints, getRunOntologyResearchValue, listKnowledgeAssets } from "@/engine/knowledge_browser";
import type { OntologyResearchEffectKind } from "@/engine/ontology_research_value";
import {
  judgmentDecisionStatusLabel,
  judgmentStrengthLabel,
  researcherLanguage,
} from "@/app/lib/researcher-stage-output";
import { actionLabel, runStatusLabel, stageLabel } from "@/app/lib/ui-labels";
import { ontologyTypeLabel } from "@/engine/ontology_display_labels";
import { loadOntologyCatalog } from "@/engine/ontology_catalog";
import { loadDataMappingRegistry } from "@/engine/data_mapping_profiles";
import { affectedRunsByOntologyFingerprint } from "@/engine/ontology_impact";

export const dynamic = "force-dynamic";

type OntologyTabId = "network" | "catalog" | "methods" | "comparability" | "queries" | "governance";
type OntologyTabGroup = "run" | "cross" | "governance";

type TabGuide = {
  id: OntologyTabId;
  group: OntologyTabGroup;
  label: string;
  blurb: string;
  answers: string;
  sees: string[];
  nextUse: string;
};

const TAB_GROUPS: Array<{ id: OntologyTabGroup; label: string; hint: string; demoted?: boolean }> = [
  { id: "run", label: "看本轮", hint: "核对当前研究用了什么知识" },
  { id: "cross", label: "跨研究", hint: "对齐口径与影响范围" },
  { id: "governance", label: "治理", hint: "专家维护正式知识库", demoted: true },
];

const TAB_GUIDE: TabGuide[] = [
  {
    id: "network",
    group: "run",
    label: "研究知识网络",
    blurb: "本轮研究实际用到了哪些类型与规则",
    answers: "本轮使用了哪些知识节点与规则？",
    sees: ["默认只显示研究相关子图", "可切换完整网络做排查", "与上方「补全 / 限制 / 关联」对照"],
    nextUse: "用来核对系统补全与约束是否合理，而不是浏览完整大图。",
  },
  {
    id: "catalog",
    group: "run",
    label: "类型目录",
    blurb: "查某个类型的定义，以及本轮有没有实例",
    answers: "这个类型是什么、本轮有没有实例？",
    sees: ["类型定义、属性与关系端点", "本轮对应实例列表", "可执行操作提示"],
    nextUse: "避免把「类型存在」当成「本轮已用」；有实例再回结构/证据页核对。",
  },
  {
    id: "methods",
    group: "run",
    label: "方法与规范",
    blurb: "各阶段可用的研究方法与规范（只读）",
    answers: "各阶段有哪些研究方法与规范？",
    sees: ["按阶段列出研究方法与规范", "每项方法的用途与摘要", "需要排查时再展开原始摘录"],
    nextUse: "查研究口径；这里只读展示各阶段可选用的方法，不在这里编辑。",
  },
  {
    id: "comparability",
    group: "cross",
    label: "跨研究口径",
    blurb: "同名正式变量能不能直接对比",
    answers: "这两个变量能不能直接比？",
    sees: ["可比 / 不可直比 / 信息不足三态", "对象、指标、单位、时间基准等口径", "阻断或信息不足的具体原因"],
    nextUse: "写跨研究结论前先看这里，避免混口径。",
  },
  {
    id: "queries",
    group: "cross",
    label: "研究问题查询",
    blurb: "证据影响哪些判断、变量出现在哪些研究",
    answers: "证据/变量的下游影响是什么？",
    sees: ["证据 → 判断的正式影响路径", "变量跨研究出现位置", "正式知识与本轮候选区分"],
    nextUse: "评估补证与改判的波及面，再回到证据台或判断审阅。",
  },
  {
    id: "governance",
    group: "governance",
    label: "知识缺口治理",
    blurb: "专家确认候选缺口，创建并跟踪正式变更提案",
    answers: "哪些本轮候选值得进入正式知识库？",
    sees: ["统一语义目录、数据映射与运行基线状态", "跨研究频次与复用信号", "候选确认、变更受理与正式发布状态"],
    nextUse: "候选受理后必须经过影响分析、批准、实施和验证；只有绑定正式指纹后才算发布。",
  },
];

function displayComparisonField(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.map(String).join("、") || fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function tabHref(tabId: OntologyTabId, runId?: string): string {
  if (tabId === "governance" || tabId === "comparability") return `/ontology?tab=${tabId}`;
  if (tabId === "queries") return `/ontology?tab=queries${runId ? `&queryRunId=${runId}` : ""}`;
  return `/ontology?tab=${tabId}${runId ? `&runId=${runId}` : ""}`;
}

function knowledgeSourceLabel(sourceFile: string): string {
  if (sourceFile.includes("semiconductor")) return "半导体领域知识";
  if (sourceFile.includes("/rules/")) return "判断与约束规则";
  if (sourceFile.includes("01_通用")) return "通用研究知识";
  return "正式知识库";
}

function knowledgeCategoryLabel(category: string): string {
  return ({
    Object: "对象类型",
    Relation: "关系类型",
    Rule: "研究规则",
    Scenario: "研究场景",
  } as Record<string, string>)[category] || category;
}

function methodAssetTitle(file: string, title: string): string {
  const source = `${file} ${title}`;
  if (/runtime quality card/i.test(source)) return "本阶段质量检查标准";
  if (/MCP通道注册/i.test(source)) return "数据取得通道与来源边界";
  if (/MCP查询快速参考/i.test(source)) return "数据查询操作参考";
  if (/表达审计模板/.test(source)) return "报告表达审计规范";
  if (/证据/.test(source)) return "证据采集与核验规范";
  if (/判断/.test(source)) return "判断形成与审阅规范";
  if (/结构/.test(source)) return "研究结构设计规范";
  if (/范围/.test(source)) return "研究范围界定规范";
  if (/交付|报告/.test(source)) return "研究交付规范";
  return title
    .replace(/\.(md|ya?ml|json)$/i, "")
    .replace(/^[A-Z]{1,5}\d*[_-]+/i, "")
    .replace(/^\d+[A-Z]?[\s_-]+/i, "")
    .replace(/投研本体框架/g, "研究知识框架")
    .replace(/领域本体/g, "领域知识")
    .replace(/[_-]+/g, " ");
}

type MethodAsset = ReturnType<typeof listKnowledgeAssets>[number];

function groupMethodAssets(assets: MethodAsset[]) {
  const grouped = new Map<string, { stage: string; title: string; entries: MethodAsset[] }>();
  for (const asset of assets) {
    const title = methodAssetTitle(asset.file, asset.title);
    const key = `${asset.stage}:${title}`;
    const existing = grouped.get(key);
    if (existing) existing.entries.push(asset);
    else grouped.set(key, { stage: asset.stage, title, entries: [asset] });
  }
  return Array.from(grouped.values());
}

export default async function OntologyPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; runId?: string; tab?: string; scope?: string; queryRunId?: string }>;
}) {
  const q = await searchParams;
  const nodes = loadOntology();
  const nodeLabelById = new Map(nodes.map((node) => [node.id, node.name]));
  const displayNodeLabel = (id: string) => nodeLabelById.get(id) || ontologyTypeLabel(id);
  const selected = nodes.find((n) => n.id === q.node) || nodes[0];
  const runs = listRuns();
  const ontologyCatalog = loadOntologyCatalog();
  const mappingRegistry = loadDataMappingRegistry();
  const affectedLegacyRuns = affectedRunsByOntologyFingerprint(
    runs.flatMap((run) => listArtifacts(run.id)),
    ontologyCatalog.fingerprint,
  );
  const statusRank: Record<string, number> = { active: 0, in_progress: 0, blocked: 1, complete: 2, completed: 2 };
  const researchRuns = runs
    .filter((run) => run.current_stage > 0 && !["draft", "archived"].includes(run.status))
    .sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const runKnowledge = new Map(researchRuns.map((run) => {
    const touchpoints = collectRunOntologyTouchpoints(run.id);
    const value = getRunOntologyResearchValue(run.id);
    return [run.id, { touchpoints, value, score: touchpoints.length + (value?.effects.length || 0) }] as const;
  }));
  const defaultKnowledgeRun = researchRuns.find((run) => (runKnowledge.get(run.id)?.score || 0) > 0) || researchRuns[0];
  const runId = researchRuns.some((run) => run.id === q.runId)
    ? q.runId
    : defaultKnowledgeRun?.id;
  const requestedTab = q.tab || "network";
  const tabGuide = TAB_GUIDE.find((item) => item.id === requestedTab) || TAB_GUIDE[0];
  const tab = tabGuide.id;
  const touched = runId ? runKnowledge.get(runId)?.touchpoints || [] : [];
  const ontologyValue = runId ? runKnowledge.get(runId)?.value || null : null;
  const allRelevantIds = [...new Set([...touched, ...(ontologyValue?.relevant_node_ids || [])])];
  const showFullNetwork = q.scope === "all" || !runId;
  const visibleNodes = showFullNetwork ? nodes : selectRelevantOntologyNodes(nodes, allRelevantIds);
  const network = buildOntologyNetworkGraph(visibleNodes, allRelevantIds);
  const assets = listKnowledgeAssets();
  const methodAssetGroups = groupMethodAssets(assets);
  const methodAssetsByStage = Object.groupBy(methodAssetGroups, (asset) => asset.stage);
  const linked = selected && runId
    ? ontologyInstances(selected.id, runId)
    : { instances: [] as any[], sources: [] as Array<{ id: string; url: string; title: string }>, graph_source: "", executable_actions: [] as string[] };
  const groups = Object.groupBy(nodes, (n) => n.category);
  const comparabilityGroups = tab === "comparability" ? listCrossRunVariableComparability() : [];
  const queryRunId = researchRuns.some((run) => run.id === q.queryRunId) ? q.queryRunId! : runId;
  const evidenceImpactQueries = tab === "queries" && queryRunId ? listEvidenceImpactQueries(queryRunId) : [];
  const variableUsageQueries = tab === "queries" ? listVariableUsageQueries() : [];
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
          <h1>看懂系统用了什么知识</h1>
          <p className="muted">
            这里不是新建研究入口，而是回答三类问题：本轮用了什么、跨研究能否对齐、知识缺口要不要进入正式库。
          </p>
          {!runId ? (
            <p className="muted ontology-run-hint">当前还没有可高亮的研究；先创建研究后，「看本轮」视图才有任务上下文。</p>
          ) : (
            <p className="muted ontology-run-hint">切换研究后，「看本轮」相关视图会按该研究高亮与过滤。</p>
          )}
        </div>
        {runId && ["network", "catalog"].includes(tab) ? <form className="ontology-run-switcher">
          <input type="hidden" name="node" value={selected?.id || ""} />
          <input type="hidden" name="tab" value={tab} />
          <label>
            <span>高亮研究</span>
            <select name="runId" defaultValue={runId} onChange={undefined}>
              {researchRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.parent_run_id ? "增量" : "原始"} · {runStatusLabel(r.status)} · {r.question.slice(0, 28)}
                </option>
              ))}
            </select>
          </label>
          <button className="button-secondary">切换</button>
        </form> : null}
      </div>

      <nav className="card ontology-tab-nav" aria-label="知识库能力分组">
        {TAB_GROUPS.map((group) => {
          const items = TAB_GUIDE.filter((item) => item.group === group.id);
          const groupLinks = (
            <div className="ontology-tab-links">
              {items.map((item) => (
                <Link
                  className={`ontology-tab-link${tab === item.id ? " active" : ""}`}
                  href={tabHref(item.id, runId)}
                  key={item.id}
                >
                  <strong>{item.label}</strong>
                  <span>{item.blurb}</span>
                </Link>
              ))}
            </div>
          );

          // 看本轮始终展开
          if (group.id === "run") {
            return (
              <div className="ontology-tab-group" key={group.id}>
                <div className="ontology-tab-group-head">
                  <strong>{group.label}</strong>
                  <span>{group.hint}</span>
                </div>
                {groupLinks}
              </div>
            );
          }

          // 跨研究和治理默认折叠，当前活跃Tab所在分组自动展开
          const isActiveGroup = items.some((item) => item.id === tab);
          return (
            <details className={`ontology-tab-group demoted`} key={group.id} open={isActiveGroup}>
              <summary className="ontology-tab-group-head">
                <strong>{group.label}</strong>
                <span>{group.hint}</span>
              </summary>
              {groupLinks}
            </details>
          );
        })}
      </nav>

      <section className="card ontology-tab-guide" aria-label={`${tabGuide.label}用途说明`}>
        <div className="ontology-tab-guide-title">
          <div className="eyebrow">本页回答</div>
          <h2>{tabGuide.answers}</h2>
        </div>
        <div className="ontology-tab-guide-grid">
          <div>
            <strong>你能看到</strong>
            <ul>
              {tabGuide.sees.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <strong>后续作用</strong>
            <p>{tabGuide.nextUse}</p>
          </div>
        </div>
      </section>

      {runId && ontologyValue && tab === "network" ? (
        <section className="card ontology-value-summary">
          <div className="section-heading">
            <div>
              <div className="eyebrow">知识库在本研究中做了什么</div>
              <h2>不是展示节点，而是补全口径、限制越界并连接影响路径</h2>
            </div>
            <span className="badge">{ontologyValue.effects.length} 项可追溯作用</span>
          </div>
          <div className="ontology-value-grid">
            {effectKinds.map(({ kind, label, description }) => {
              const effects = ontologyValue.effects.filter((effect) => effect.kind === kind);
              const visibleEffects = effects.filter((effect, index) => {
                const title = researcherLanguage(effect.title);
                return effects.findIndex((candidate) => researcherLanguage(candidate.title) === title) === index;
              });
              return (
                <article className={`ontology-value-column ${kind}`} key={kind}>
                  <div className="ontology-value-column-head">
                    <strong>{label} · {visibleEffects.length} 类</strong>
                    <span>{description}</span>
                  </div>
                  {visibleEffects.slice(0, 4).map((effect) => (
                    <details key={effect.id}>
                      <summary>{researcherLanguage(effect.title)}</summary>
                      <p>{researcherLanguage(effect.explanation)}</p>
                      <small>{researcherLanguage(effect.result)}</small>
                    </details>
                  ))}
                  {!visibleEffects.length ? <p className="muted">当前阶段尚无可核验记录</p> : null}
                  {effects.length > visibleEffects.length ? <p className="muted">以上作用对应 {effects.length} 条审计记录，重复路径已合并。</p> : null}
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
              <strong>{showFullNetwork ? "完整知识网络（高级视图）" : "本研究相关子图"}</strong>
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
          <details className="ontology-network-details" open={showFullNetwork}>
            <summary>
              <strong>{showFullNetwork ? "完整知识网络" : "展开本研究相关知识图"}</strong>
              <span>{network.nodes.length} 个节点 · {network.edges.length} 条关系</span>
            </summary>
            <ResearchGraphLazy nodes={network.nodes} edges={network.edges} emptyMessage="当前研究尚未形成可展示的知识关联" />
          </details>
        </>
      ) : null}
      {tab === "catalog" ? (
        <div className="three-col">
        <aside className="card ontology-list">
          {Object.entries(groups).map(([group, items]) => (
            <details key={group} open={Boolean(q.node) && selected?.category === group}>
              <summary><strong>{knowledgeCategoryLabel(group)}</strong><span className="muted"> · {items?.length || 0}</span></summary>
              {items?.map((n) => (
                <Link
                  className={n.id === selected?.id ? "active" : ""}
                  href={`/ontology?tab=catalog&node=${encodeURIComponent(n.id)}${runId ? `&runId=${runId}` : ""}`}
                  key={n.id}
                >
                  {n.name}
                </Link>
              ))}
            </details>
          ))}
        </aside>
        <section className="card">
          {selected && (
            <>
              <span className="badge">{knowledgeCategoryLabel(selected.category)}</span>
              <h1>{selected.name}</h1>
              <p>{selected.description || "暂无说明"}</p>
              <h3>关系端点</h3>
              <p>
                起点类型：{selected.source_types.map(displayNodeLabel).join("、") || "—"}
                <br />
                终点类型：{selected.target_types.map(displayNodeLabel).join("、") || "—"}
              </p>
              <p className="muted">知识来源：{knowledgeSourceLabel(selected.source_file)}</p>
              {runId ? (
                <div className="ontology-run-instances">
                  <h3>本研究中的对应实例</h3>
                  {linked.instances.length ? (
                    <ul className="source-list">
                      {linked.instances.slice(0, 8).map((instance: any) => (
                        <li key={instance.object.id}>
                          <strong>{instance.label}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">本轮尚无该类型的实例，不能仅因类型存在就声称已用于研究。</p>}
                  <p className="muted">可用于：{linked.executable_actions.map(actionLabel).join("、") || "暂无直接操作"}</p>
                </div>
              ) : null}
              <details>
                <summary>查看技术定义（审计）</summary>
                <p><code>{selected.id}</code></p>
                <h3>登记字段</h3>
                <p>{selected.properties.join("、") || "无"}</p>
                {selected.write_scope?.length ? <p>可写范围：{selected.write_scope.join("、")}</p> : null}
                {selected.function_ref ? <p>关联函数：{selected.function_ref}</p> : null}
                <p className="muted">{selected.source_file}</p>
              </details>
            </>
          )}
        </section>
        </div>
      ) : null}
      {tab === "methods" ? (
        <section className="card">
          <h2>各阶段可用的方法与规范</h2>
          <p className="muted">相同用途已合并；先按阶段展开，需要排查时再看底层文件摘录。</p>
          <div className="artifact-ledger">
            {Object.entries(methodAssetsByStage).map(([stage, stageAssets]) => (
              <details key={stage} style={{ marginBottom: 10 }}>
                <summary><strong>{stageLabel(stage)}阶段</strong> · {stageAssets?.length || 0} 类方法与规范</summary>
                {stageAssets?.map((asset) => (
                  <details key={`${asset.stage}:${asset.title}`} style={{ margin: "10px 0 10px 18px" }}>
                    <summary>{asset.title}</summary>
                    <p className="muted">用于{stageLabel(asset.stage)}阶段的生成、核验与人工确认。</p>
                    <details>
                      <summary>查看原始方法摘录（审计）</summary>
                      {asset.entries.map((entry) => (
                        <div key={entry.file}>
                          <p className="muted">{entry.file}</p>
                          <pre className="json-editor" style={{ whiteSpace: "pre-wrap" }}>{entry.snippet}</pre>
                        </div>
                      ))}
                    </details>
                  </details>
                ))}
              </details>
            ))}
          </div>
        </section>
      ) : null}
      {tab === "governance" ? (
        <>
          <section className="card">
            <div className="section-heading">
              <div>
                <div className="eyebrow">统一语义基础设施</div>
                <h2>本体是对象、关系、约束与数据映射的唯一语义入口</h2>
                <p className="muted">
                  这里显示当前正式基线及其消费状态；研究方法和流程仍由各自模块执行，不写进本体。
                </p>
              </div>
              <span className="badge">{ontologyCatalog.fingerprint.slice(0, 19)}…</span>
            </div>
            <div className="ontology-value-grid">
              <article className="ontology-value-column completion">
                <div className="ontology-value-column-head">
                  <strong>正式语义目录</strong>
                  <span>全系统统一定义</span>
                </div>
                <p>
                  {ontologyCatalog.object_types.size} 类对象 · {ontologyCatalog.relation_types.size} 类关系 ·
                  {" "}{ontologyCatalog.rules.size} 项稳定约束 · {ontologyCatalog.scenario_types.size} 类研究场景
                </p>
                <small>Runtime、Schema、图合同与查询均从同一目录读取。</small>
              </article>
              <article className="ontology-value-column connection">
                <div className="ontology-value-column-head">
                  <strong>外部数据映射</strong>
                  <span>版本化字段血缘</span>
                </div>
                <p>
                  {mappingRegistry.profiles.filter((profile) => profile.status === "active").length}
                  /{mappingRegistry.required_connectors.length} 个运行通道已登记
                </p>
                <small>
                  {mappingRegistry.profiles.map((profile) =>
                    `${profile.connector} → ${profile.target_mappings.map((mapping) => ontologyTypeLabel(mapping.target_type)).join(" / ")}`,
                  ).join("；")}
                </small>
              </article>
              <article className={`ontology-value-column ${affectedLegacyRuns.length ? "constraint" : "completion"}`}>
                <div className="ontology-value-column-head">
                  <strong>运行基线一致性</strong>
                  <span>按 semantic_context 指纹识别</span>
                </div>
                <p>{affectedLegacyRuns.length ? `${affectedLegacyRuns.length} 个运行仍绑定旧本体` : "未发现绑定旧本体指纹的运行"}</p>
                <small>
                  {affectedLegacyRuns.length
                    ? "这些运行需要影响审阅或按需重算；系统不会静默改写历史结论。"
                    : "没有发现需要迁移的已指纹化阶段产物。"}
                </small>
              </article>
            </div>
          </section>
          <OntologyCandidateQueue />
        </>
      ) : null}
      {tab === "comparability" ? (
        <section className="ontology-comparability">
          {comparabilityGroups.map((group) => {
            const observationById = new Map(group.observations.map((observation) => [observation.observation_id, observation]));
            return (
              <article className="card comparability-group" key={group.ontology_node_id}>
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">正式变量</div>
                    <h2>{group.ontology_label}</h2>
                    <p className="muted">{new Set(group.observations.map((observation) => observation.run_id)).size} 个研究 · {group.observations.length} 个变量实例</p>
                  </div>
                  <div className="comparability-counts">
                    <span className="aligned">可比 {group.aligned_count}</span>
                    <span className="blocked">不可直比 {group.blocked_count}</span>
                    <span className="insufficient">信息不足 {group.insufficient_count}</span>
                  </div>
                </div>
                <div className="comparability-list">
                  {group.comparisons.slice(0, 12).map((comparison) => {
                    const left = observationById.get(comparison.left_observation_id)!;
                    const right = observationById.get(comparison.right_observation_id)!;
                    return (
                      <details className={comparison.status} key={`${comparison.left_observation_id}:${comparison.right_observation_id}`}>
                        <summary>
                          <span>{comparison.status === "aligned" ? "可直接比较" : comparison.status === "blocked" ? "不可直接比较" : "信息不足"}</span>
                          <strong>{left.name} ↔ {right.name}</strong>
                        </summary>
                        <div className="comparability-pair">
                          <p>
                            <b>{left.question}</b>
                            <small>{left.name} · 观测期 {displayComparisonField(left.observation_period, "未填写")} · {displayComparisonField(left.unit, "单位未填写")} · {displayComparisonField(left.time_basis, "时间基准未填写")}</small>
                          </p>
                          <p>
                            <b>{right.question}</b>
                            <small>{right.name} · 观测期 {displayComparisonField(right.observation_period, "未填写")} · {displayComparisonField(right.unit, "单位未填写")} · {displayComparisonField(right.time_basis, "时间基准未填写")}</small>
                          </p>
                        </div>
                        <ul>{comparison.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      </details>
                    );
                  })}
                </div>
              </article>
            );
          })}
          {!comparabilityGroups.length ? <div className="card"><p className="muted">当前还没有同一正式变量跨两个研究出现的记录。</p></div> : null}
        </section>
      ) : null}
      {tab === "queries" ? (
        <section className="ontology-query-workbench">
          <div className="ontology-query-grid">
            <article className="card ontology-query-section">
              <div className="section-heading">
                <div><div className="eyebrow">问题一</div><h2>这条证据影响哪些判断？</h2></div>
                <form>
                  <input type="hidden" name="tab" value="queries" />
                  <select name="queryRunId" defaultValue={queryRunId}>
                    {researchRuns.map((run) => <option key={run.id} value={run.id}>{run.question.slice(0, 36)}</option>)}
                  </select>
                  <button className="button-secondary">切换研究</button>
                </form>
              </div>
              <div className="ontology-query-results">
                {evidenceImpactQueries.map((result) => (
                  <details key={result.evidence.id}>
                    <summary><strong>{result.evidence.label}</strong><span>{result.impacted_judgments.length} 个下游判断</span></summary>
                    {result.impacted_judgments.length ? result.impacted_judgments.map((judgment) => (
                      <div className="ontology-impact-result" key={judgment.id}>
                        <strong>{judgment.label}</strong>
                        <small>{judgmentStrengthLabel(judgment.strength)} · {judgmentDecisionStatusLabel(judgment.decision_status)}</small>
                        <p>影响路径：{judgment.path_labels.map(researcherLanguage).join(" → ")}</p>
                      </div>
                    )) : <p className="muted">当前研究尚未形成可追溯的下游判断；可能仍处于结构或证据阶段。</p>}
                  </details>
                ))}
                {!evidenceImpactQueries.length ? <p className="muted">当前研究还没有已确认事实。</p> : null}
              </div>
            </article>
            <article className="card ontology-query-section">
              <div className="section-heading"><div><div className="eyebrow">问题二</div><h2>这个变量在哪些研究出现？</h2></div></div>
              <div className="ontology-query-results variable-usage-results">
                {variableUsageQueries.slice(0, 40).map((usage) => (
                  <details key={usage.semantic_ref}>
                    <summary>
                      <strong>{usage.label}</strong>
                      <span>{usage.source === "formal" ? "正式知识" : "本轮候选"} · {usage.run_count} 个研究</span>
                    </summary>
                    <ul className="source-list">
                      {usage.occurrences.slice(0, 10).map((occurrence) => (
                        <li key={`${occurrence.run_id}:${occurrence.variable_id}`}>
                          <Link href={`/runs/${occurrence.run_id}/structure`}>{occurrence.question}</Link>
                          <small className="muted"> · {occurrence.name}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}
    </>
  );
}
