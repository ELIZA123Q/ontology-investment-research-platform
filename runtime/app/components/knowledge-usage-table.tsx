"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type KnowledgeUsageRow = {
  semantic_ref: string;
  label: string;
  source: "formal" | "task_local";
  knowledge_kind: "object" | "relation" | "rule" | "variable";
  domains: string[];
  application_status: "applied" | "unused" | "candidate";
  run_count: number;
  occurrence_count: number;
  last_used_at: string;
  occurrences: Array<{ run_id: string; question: string; name: string }>;
  comparison?: {
    aligned_count: number;
    blocked_count: number;
    insufficient_count: number;
    comparisons: Array<{ left_observation_id: string; right_observation_id: string; status: string; reasons: string[] }>;
  };
};

const kindLabels = { object: "对象", relation: "关系", rule: "规则", variable: "变量" };
const statusLabels = { applied: "已应用", unused: "未使用", candidate: "候选" };

export function KnowledgeUsageTable({ rows }: { rows: KnowledgeUsageRow[] }) {
  const [query, setQuery] = useState("");
  const [authority, setAuthority] = useState("");
  const [kind, setKind] = useState("");
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("");
  const domains = useMemo(() => [...new Set(rows.flatMap((row) => row.domains))].sort(), [rows]);
  const visible = useMemo(() => rows.filter((row) => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return (!normalized || `${row.label} ${row.semantic_ref}`.toLocaleLowerCase("zh-CN").includes(normalized))
      && (!authority || row.source === authority)
      && (!kind || row.knowledge_kind === kind)
      && (!domain || row.domains.includes(domain))
      && (!status || row.application_status === status);
  }).slice(0, 160), [authority, domain, kind, query, rows, status]);

  return <div className="card knowledge-usage-table">
    <div className="knowledge-usage-filters">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识名称或编号" aria-label="搜索知识应用" />
      <select value={authority} onChange={(event) => setAuthority(event.target.value)} aria-label="筛选权威状态"><option value="">正式与非正式</option><option value="formal">正式知识</option><option value="task_local">非正式候选</option></select>
      <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="筛选知识类型"><option value="">全部知识类型</option>{Object.entries(kindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="筛选领域"><option value="">全部领域</option>{domains.map((value) => <option value={value} key={value}>{value}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="筛选应用状态"><option value="">全部应用状态</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <span>{visible.length} 项</span>
    </div>
    <div className="knowledge-usage-head"><span>知识条目</span><span>权威 / 类型</span><span>研究数</span><span>出现次数</span><span>跨研究口径</span></div>
    {visible.map((usage) => <details className="knowledge-usage-row" id={`usage-${encodeURIComponent(usage.semantic_ref)}`} key={usage.semantic_ref}>
      <summary><strong>{usage.label}</strong><span className={usage.source}>{usage.source === "formal" ? "正式知识" : "非正式候选"} · {kindLabels[usage.knowledge_kind]}</span><b>{usage.run_count}</b><b>{usage.occurrence_count}</b><span>{usage.comparison ? `可比 ${usage.comparison.aligned_count} · 阻断 ${usage.comparison.blocked_count} · 不足 ${usage.comparison.insufficient_count}` : `${statusLabels[usage.application_status]}${usage.last_used_at ? ` · ${usage.last_used_at.slice(0, 10)}` : ""}`}</span></summary>
      <div><ul>{usage.occurrences.slice(0, 12).map((occurrence) => <li key={`${occurrence.run_id}:${occurrence.name}`}><Link href={`/knowledge/task/graph?runId=${occurrence.run_id}`}>{occurrence.question}</Link><small>{occurrence.name}</small></li>)}</ul><div>{usage.comparison?.comparisons.slice(0, 5).map((item) => <p key={`${item.left_observation_id}:${item.right_observation_id}`}><strong>{item.status === "aligned" ? "可比" : item.status === "blocked" ? "不可直比" : "信息不足"}</strong>：{item.reasons.join("；")}</p>)}{!usage.occurrences.length ? <p>尚未被任何研究实际触及。</p> : null}</div></div>
    </details>)}
    {!visible.length ? <div className="knowledge-usage-empty">没有符合当前筛选条件的知识。</div> : null}
  </div>;
}
