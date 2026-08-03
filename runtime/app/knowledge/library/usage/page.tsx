import { KnowledgeLibrarySummary } from "@/app/components/knowledge-library-summary";
import { KnowledgeUsageTable } from "@/app/components/knowledge-usage-table";
import { loadLibraryKnowledgePage } from "@/app/lib/knowledge-page-data";

export const dynamic = "force-dynamic";

export default function KnowledgeLibraryUsagePage() {
  const data = loadLibraryKnowledgePage();
  const used = data.usageRows.filter((row) => row.application_status === "applied").length;
  const comparable = data.usageRows.filter((row) => row.comparison?.aligned_count).length;
  return <section className="knowledge-library-page"><KnowledgeLibrarySummary data={{ objectCount: data.catalog.object_types.size, relationCount: data.catalog.relation_types.size, ruleCount: data.catalog.rules.size, runCount: data.runs.length, candidateCount: data.candidates.length, repeatedCount: data.repeatedCandidates.length, fingerprint: data.catalog.fingerprint, legacyRunCount: data.affectedLegacyRuns.length }} />
    <section className="knowledge-outcome-strip"><article><span>正在被使用</span><strong>{used}</strong><small>有研究实际触及</small></article><article><span>跨研究可比</span><strong>{comparable}</strong><small>已形成明确对齐结果</small></article><article className={data.unusedFormalCount ? "attention" : ""}><span>尚未使用</span><strong>{data.unusedFormalCount}</strong><small>可检查是否冗余或待推广</small></article></section>
    <section className="knowledge-section-block"><div className="knowledge-block-heading"><div><span className="knowledge-step-kicker">本页回答：哪些知识真正被用过</span><h2>知识应用与跨研究可比性</h2><p>先看名称、用途和涉及研究；技术 ID 放在展开详情。点击研究名称会直接进入该研究的知识图谱。</p></div></div><KnowledgeUsageTable rows={data.usageRows} /></section>
  </section>;
}
