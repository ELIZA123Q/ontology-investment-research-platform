import { KnowledgeLibrarySummary } from "@/app/components/knowledge-library-summary";
import { KnowledgePackageImport } from "@/app/components/knowledge-package-import";
import { OntologyCandidateQueue } from "@/app/components/ontology-candidate-queue";
import { loadLibraryKnowledgePage } from "@/app/lib/knowledge-page-data";

export const dynamic = "force-dynamic";

export default function KnowledgeLibraryGapsPage() {
  const data = loadLibraryKnowledgePage();
  const suggested = data.candidates.filter((candidate) => candidate.run_count > 1).length;
  const related = data.candidates.filter((candidate) => candidate.similarities?.some((item) => item.confidence === "high")).length;
  return <section className="knowledge-library-page" id="gaps"><KnowledgeLibrarySummary data={{ objectCount: data.catalog.object_types.size, relationCount: data.catalog.relation_types.size, ruleCount: data.catalog.rules.size, runCount: data.runs.length, candidateCount: data.candidates.length, repeatedCount: data.repeatedCandidates.length, fingerprint: data.catalog.fingerprint, legacyRunCount: data.affectedLegacyRuns.length }} />
    <section className="knowledge-outcome-strip"><article className={suggested ? "attention" : ""}><span>建议纳入本体</span><strong>{suggested}</strong><small>至少跨两个研究复用</small></article><article><span>高置信近义</span><strong>{related}</strong><small>可审查合并依据</small></article><article><span>继续观察</span><strong>{Math.max(0, data.candidates.length - suggested)}</strong><small>单研究候选降低优先级</small></article></section>
    <section className="knowledge-section-block"><div className="knowledge-block-heading"><div><span className="knowledge-step-kicker">本页回答：为什么值得纳入正式本体</span><h2>本体缺口与候选治理</h2><p>优先看跨研究复用、定义变体和高置信近义依据；一次确认后，后台仍完整执行影响分析、验证、发布与审计。</p></div></div><OntologyCandidateQueue /></section>
    <section className="knowledge-library-tools"><article className="card"><span className="knowledge-step-kicker">正式基线包</span><h3>{data.baseline.package_id}</h3><p>包含正式本体、研究方法、数据映射和校验和，严格排除 task_local。</p><a className="button" href="/api/knowledge/package?kind=knowledge_baseline">下载正式基线 ↓</a></article><article className="card"><span className="knowledge-step-kicker">候选知识包</span><h3>校验后导入治理区</h3><p>导入不会直接污染正式基线，仍需专家确认与完整治理流程。</p><KnowledgePackageImport /></article></section>
  </section>;
}
