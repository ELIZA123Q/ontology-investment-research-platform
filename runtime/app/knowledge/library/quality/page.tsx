import Link from "next/link";
import { KnowledgeLibrarySummary } from "@/app/components/knowledge-library-summary";
import { loadLibraryKnowledgePage } from "@/app/lib/knowledge-page-data";

export const dynamic = "force-dynamic";

export default function KnowledgeLibraryQualityPage() {
  const data = loadLibraryKnowledgePage();
  const issues = [
    { id: "endpoints", severity: data.danglingRelations.length || data.duplicateOntologyIds ? "high" : "pass", title: "目录、重复 ID 与关系端点", result: data.danglingRelations.length || data.duplicateOntologyIds ? `${data.duplicateOntologyIds} 个重复 ID · ${data.danglingRelations.length} 条悬空关系` : "检查通过", action: "定位知识地图", href: "/knowledge/library/map" },
    { id: "legacy", severity: data.affectedLegacyRuns.length ? "medium" : "pass", title: "研究基线一致性", result: data.affectedLegacyRuns.length ? `${data.affectedLegacyRuns.length} 个研究仍绑定旧指纹` : "全部采用当前指纹", action: "查看受影响研究", href: "/knowledge/library/usage" },
    { id: "mapping", severity: data.activeMappings >= data.mappings.required_connectors.length ? "pass" : "high", title: "数据映射完整性", result: `${data.activeMappings}/${data.mappings.required_connectors.length} 个必需通道活动`, action: "检查映射定义", href: "/knowledge/library/usage" },
    { id: "candidate", severity: data.repeatedCandidates.length ? "medium" : "pass", title: "重复非正式概念", result: data.repeatedCandidates.length ? `${data.repeatedCandidates.length} 项跨研究重复` : "没有跨研究重复候选", action: "进入缺口治理", href: "/knowledge/library/gaps" },
    { id: "unused", severity: data.unusedFormalCount ? "low" : "pass", title: "未使用正式知识", result: `${data.unusedFormalCount} 项未观察到实际触及`, action: "在应用表筛选", href: "/knowledge/library/usage" },
  ];
  const actionable = issues.filter((issue) => issue.severity !== "pass");
  return <section className="knowledge-library-page"><KnowledgeLibrarySummary data={{ objectCount: data.catalog.object_types.size, relationCount: data.catalog.relation_types.size, ruleCount: data.catalog.rules.size, runCount: data.runs.length, candidateCount: data.candidates.length, repeatedCount: data.repeatedCandidates.length, fingerprint: data.catalog.fingerprint, legacyRunCount: data.affectedLegacyRuns.length }} />
    <section className="knowledge-outcome-strip"><article className={actionable.length ? "attention" : ""}><span>需要处理</span><strong>{actionable.length}</strong><small>按影响程度排序</small></article><article><span>正式知识覆盖</span><strong>{data.usedFormalCount}/{data.ontologyNodes.length}</strong><small>来自有效研究产物</small></article><article><span>检查通过</span><strong>{issues.length - actionable.length}</strong><small>通过项收进次级区域</small></article></section>
    <section className="knowledge-section-block"><div className="knowledge-block-heading"><div><span className="knowledge-step-kicker">本页回答：现在最该处理什么</span><h2>需要关注的知识质量问题</h2><p>这里只优先呈现需要行动的问题，每项都给出影响和下一步入口；通过项仍保留在下方审计记录中。</p></div></div><div className="knowledge-quality-grid actionable">{actionable.map((issue) => <article className={`card severity-${issue.severity}`} key={issue.id}><span>{issue.severity === "high" ? "高优先级" : issue.severity === "medium" ? "中优先级" : "低优先级"}</span><h3>{issue.title}</h3><strong>{issue.result}</strong><p>该检查直接影响知识可解释性、跨研究复用或本体治理判断。</p><Link href={issue.href}>{issue.action} →</Link></article>)}</div>{!actionable.length ? <div className="knowledge-all-pass"><strong>当前没有需要立即处理的质量问题</strong><span>所有已配置检查均通过。</span></div> : null}
      <details className="card knowledge-passed-checks"><summary>查看已通过检查（{issues.length - actionable.length}）</summary><ul>{issues.filter((issue) => issue.severity === "pass").map((issue) => <li key={issue.id}><strong>{issue.title}</strong><span>{issue.result}</span></li>)}</ul></details>
    </section>
  </section>;
}
