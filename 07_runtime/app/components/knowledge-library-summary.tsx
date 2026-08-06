export function KnowledgeLibrarySummary({ data }: { data: {
  objectCount: number; relationCount: number; ruleCount: number; runCount: number; candidateCount: number; repeatedCount: number; fingerprint: string; legacyRunCount: number;
} }) {
  return <section className="knowledge-library-summary"><article><span>对象类型</span><strong>{data.objectCount}</strong><small>知识库描述什么</small></article><article><span>Link 类型</span><strong>{data.relationCount}</strong><small>对象之间如何连接</small></article><article><span>判断规则</span><strong>{data.ruleCount}</strong><small>作为约束附着到对象与关系</small></article><article><span>已统计研究</span><strong>{data.runCount}</strong><small>进入全局使用统计</small></article><article><span>待治理候选</span><strong>{data.candidateCount}</strong><small>{data.repeatedCount} 项跨研究重复</small></article><article><span>当前知识版本</span><strong className="fingerprint">{data.fingerprint.slice(7, 15)}</strong><small>{data.legacyRunCount} 个研究仍使用旧版</small></article></section>;
}
