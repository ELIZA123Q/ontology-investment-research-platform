"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, formatRelativeTime } from "@/app/components/client-api";

interface KnowledgeCandidate {
  id: string;
  assetKind: string;
  identityKey: string;
  operation: string;
  riskLevel: 0 | 1 | 2 | 3;
  status: string;
  confidence: number;
  updatedAt: string;
}

export function KnowledgeGovernancePanel() {
  const [items, setItems] = useState<KnowledgeCandidate[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => setItems(await apiRequest<KnowledgeCandidate[]>("/api/v2/knowledge/candidates")), []);
  useEffect(() => { void refresh().catch((reason) => setError(String(reason))); }, [refresh]);
  const open = useMemo(() => items.filter((item) => !["released", "rejected", "superseded"].includes(item.status)).slice(0, 8), [items]);

  async function decide(item: KnowledgeCandidate, decision: "approved" | "rejected") {
    setBusy(item.id); setError("");
    try {
      const candidate = await apiRequest<KnowledgeCandidate>(`/api/v2/knowledge/candidates/${item.id}/decisions`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewer: "local-governance-owner", reviewerRole: "governance_owner", note: decision === "approved" ? "已核验候选来源、作用域和可逆性" : "候选不满足当前知识晋级要求" }),
      });
      if (candidate.status === "approved") await apiRequest("/api/v2/knowledge/releases", { method: "POST", body: JSON.stringify({ candidateIds: [item.id], createdBy: "local-governance-owner" }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(undefined); }
  }

  return <section className="v2-knowledge-governance">
    <header><div><span>GOVERNED KNOWLEDGE</span><h2>知识候选与正式发布</h2><p>研究运行只提出候选；审批和发布后，下一次任务才会锁定包含该资产的新知识包。</p></div><b>{open.length} 个待处理</b></header>
    {error && <p className="v2-error" role="alert">{error}</p>}
    {!open.length && <div className="v2-empty"><strong>当前没有待处理候选</strong><p>完成一次研究后，方法、失败模式和主题索引候选会出现在这里。</p></div>}
    <div className="v2-knowledge-list">{open.map((item) => <article key={item.id}>
      <div><span>L{item.riskLevel} · {item.assetKind}</span><time>{formatRelativeTime(item.updatedAt)}</time></div>
      <strong>{item.identityKey}</strong><p>{item.operation} · {item.status} · 置信度 {Math.round(item.confidence * 100)}%</p>
      <footer>{item.riskLevel <= 1 ? <><button disabled={busy === item.id} onClick={() => void decide(item, "rejected")}>拒绝</button><button disabled={busy === item.id} onClick={() => void decide(item, "approved")}>审批并发布</button></> : <small>需要专项评测和对应资产责任人审批</small>}</footer>
    </article>)}</div>
  </section>;
}
