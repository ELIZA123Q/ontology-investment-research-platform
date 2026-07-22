"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { runStatusLabel } from "@/app/lib/ui-labels";

export type RunListItem = {
  id: string;
  question: string;
  domain: string;
  current_stage: number;
  status: string;
  parent_run_id: string | null;
  descendant_count: number;
  created_at: string;
  updated_at: string;
};

type SortMode = "updated_desc" | "created_desc" | "status_group";

function domainLabel(domain: string) {
  return domain === "semiconductor" ? "半导体" : "通用";
}

function buildForest(runs: RunListItem[]) {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const children = new Map<string, RunListItem[]>();
  for (const run of runs) {
    if (!run.parent_run_id || !byId.has(run.parent_run_id)) continue;
    const siblings = children.get(run.parent_run_id) || [];
    siblings.push(run);
    children.set(run.parent_run_id, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }
  const roots = runs
    .filter((run) => !run.parent_run_id || !byId.has(run.parent_run_id))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return { roots, children };
}

export function RunList({ runs }: { runs: RunListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated_desc");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const domains = useMemo(
    () => Array.from(new Set(runs.map((run) => run.domain))).sort(),
    [runs],
  );
  const statuses = useMemo(
    () => Array.from(new Set(runs.map((run) => run.status))).sort(),
    [runs],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let next = runs.filter((run) => {
      if (domainFilter !== "all" && run.domain !== domainFilter) return false;
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (needle && !run.question.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sortMode === "created_desc") {
      next = [...next].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    } else if (sortMode === "status_group") {
      next = [...next].sort((a, b) => a.status.localeCompare(b.status) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
    } else {
      next = [...next].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    }
    return next;
  }, [runs, domainFilter, statusFilter, sortMode, query]);

  const forest = useMemo(() => buildForest(filtered), [filtered]);

  async function removeRun(run: RunListItem) {
    setBusyId(run.id);
    setError("");
    try {
      const response = await fetch(`/api/runs/${run.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "删除失败");
        return;
      }
      setConfirmId(null);
      router.refresh();
    } catch {
      setError("删除失败，请稍后重试");
    } finally {
      setBusyId(null);
    }
  }

  function renderRow(run: RunListItem, depth: number) {
    const kids = forest.children.get(run.id) || [];
    const isCollapsed = Boolean(collapsed[run.id]);
    return (
      <div key={run.id} className="run-tree-block">
        <article className={`run-row${depth > 0 ? " is-child" : ""}`} style={{ ["--run-depth" as string]: depth }}>
          <Link className="run-title" href={`/runs/${run.id}`}>
            <strong>
              {kids.length ? (
                <button
                  type="button"
                  className="run-tree-toggle"
                  aria-label={isCollapsed ? "展开增量运行" : "折叠增量运行"}
                  onClick={(event) => {
                    event.preventDefault();
                    setCollapsed((prev) => ({ ...prev, [run.id]: !prev[run.id] }));
                  }}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              ) : depth > 0 ? <span className="run-tree-spacer" /> : null}
              {run.question}
            </strong>
            <span>
              {run.parent_run_id ? "增量运行" : "原始研究"}
              {" · "}
              {runStatusLabel(run.status)}
              {run.descendant_count > 0 ? ` · ${run.descendant_count} 条增量` : ""}
            </span>
          </Link>
          <span className="domain-label">{domainLabel(run.domain)}</span>
          <div className="run-progress" aria-label={`阶段 ${run.current_stage}/5`}>
            {[1, 2, 3, 4, 5].map((stage) => (
              <i key={stage} className={stage <= run.current_stage ? "done" : undefined} />
            ))}
            <span>{run.current_stage}/5</span>
          </div>
          <div className="run-row-actions">
            {confirmId === run.id ? (
              <>
                <button
                  type="button"
                  className="button run-delete-confirm"
                  disabled={busyId === run.id}
                  onClick={() => removeRun(run)}
                >
                  {busyId === run.id ? "删除中…" : run.descendant_count > 0 ? `确认删除（含 ${run.descendant_count} 条增量）` : "确认删除"}
                </button>
                <button type="button" className="button-quiet" disabled={busyId === run.id} onClick={() => setConfirmId(null)}>取消</button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="button-quiet run-delete"
                  disabled={busyId === run.id}
                  onClick={() => setConfirmId(run.id)}
                >
                  删除
                </button>
                <Link className="row-arrow" href={`/runs/${run.id}`} aria-label={`进入 ${run.question}`}>→</Link>
              </>
            )}
          </div>
        </article>
        {!isCollapsed ? kids.map((child) => renderRow(child, depth + 1)) : null}
      </div>
    );
  }

  return (
    <>
      <div className="run-list-toolbar">
        <label className="run-search">
          <span>搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按研究问题搜索" aria-label="按研究问题搜索" />
        </label>
        <label>
          <span>领域</span>
          <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)} aria-label="按领域筛选">
            <option value="all">全部领域</option>
            {domains.map((domain) => <option key={domain} value={domain}>{domainLabel(domain)}</option>)}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="按状态筛选">
            <option value="all">全部状态</option>
            {statuses.map((status) => <option key={status} value={status}>{runStatusLabel(status)}</option>)}
          </select>
        </label>
        <label>
          <span>排序</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="排序方式">
            <option value="updated_desc">按最后更新</option>
            <option value="created_desc">按创建时间</option>
            <option value="status_group">按状态分组</option>
          </select>
        </label>
      </div>
      {error ? <div className="notice error" style={{ marginBottom: 16 }}>{error}</div> : null}
      <section className="run-list" aria-label="研究列表">
        <div className="run-list-head">
          <span>研究问题</span>
          <span>领域</span>
          <span>进度</span>
          <span></span>
        </div>
        {forest.roots.length ? forest.roots.map((run) => renderRow(run, 0)) : (
          <div className="queue-empty" style={{ padding: 24 }}>没有符合筛选条件的研究。</div>
        )}
      </section>
    </>
  );
}
