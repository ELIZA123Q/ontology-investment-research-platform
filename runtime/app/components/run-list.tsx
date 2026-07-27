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

type SortMode = "action_priority" | "updated_desc" | "created_desc" | "status_group";

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
  const roots = runs
    .filter((run) => !run.parent_run_id || !byId.has(run.parent_run_id));
  return { roots, children };
}

const actionPriority: Record<string, number> = {
  active: 0,
  in_progress: 0,
  blocked: 1,
  complete: 2,
  completed: 2,
  draft: 3,
  archived: 4,
};

function nextActionLabel(run: RunListItem) {
  if (run.status === "complete" || run.status === "completed") return "查看结论";
  if (run.status === "blocked") return "查看阻断";
  if (run.current_stage <= 0) return "开始范围";
  return `继续${["", "结构", "证据", "判断", "交付", "交付"][Math.min(run.current_stage, 5)]}`;
}

function relativeTime(value: string) {
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "刚刚更新";
  if (days === 0) return "今天更新";
  if (days === 1) return "昨天更新";
  if (days < 30) return `${days} 天前更新`;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function RunList({ runs }: { runs: RunListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("action_priority");
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
    if (sortMode === "action_priority") {
      next = [...next].sort((a, b) =>
        (actionPriority[a.status] ?? 9) - (actionPriority[b.status] ?? 9)
        || Date.parse(b.updated_at) - Date.parse(a.updated_at),
      );
    } else if (sortMode === "created_desc") {
      next = [...next].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    } else if (sortMode === "status_group") {
      next = [...next].sort((a, b) => a.status.localeCompare(b.status) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
    } else {
      next = [...next].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    }
    return next;
  }, [runs, domainFilter, statusFilter, sortMode, query]);

  const forest = useMemo(() => buildForest(filtered), [filtered]);
  const showDormantDirectly = statusFilter === "draft" || query.trim().length > 0;

  function isDormantBranch(run: RunListItem): boolean {
    const kids = forest.children.get(run.id) || [];
    return run.status === "draft"
      && run.current_stage === 0
      && kids.every(isDormantBranch);
  }

  const activeRoots = showDormantDirectly
    ? forest.roots
    : forest.roots.filter((run) => !isDormantBranch(run));
  const dormantRoots = showDormantDirectly
    ? []
    : forest.roots.filter(isDormantBranch);

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
          <div className="run-title-group">
            {kids.length ? (
              <button
                type="button"
                className="run-tree-toggle"
                aria-label={isCollapsed ? "展开增量研究" : "折叠增量研究"}
                onClick={() => setCollapsed((prev) => ({ ...prev, [run.id]: !prev[run.id] }))}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : depth > 0 ? <span className="run-tree-spacer" /> : null}
            <Link className="run-title" href={`/runs/${run.id}`}>
              <strong>{run.question}</strong>
              <span>
                {run.parent_run_id ? "增量研究" : "原始研究"}
                {" · "}
                {runStatusLabel(run.status)}
                {run.descendant_count > 0 ? ` · ${run.descendant_count} 条增量研究` : ""}
                {` · ${relativeTime(run.updated_at)}`}
              </span>
            </Link>
          </div>
          <span className="domain-label">{domainLabel(run.domain)}</span>
          <div className="run-progress" aria-label={`阶段 ${run.current_stage}/5`}>
            {[1, 2, 3, 4, 5].map((stage) => (
              <i key={stage} className={stage <= run.current_stage ? "done" : undefined} />
            ))}
            <span>{run.current_stage}/5</span>
          </div>
          <div className="run-row-actions">
            <Link className="run-next-action" href={`/runs/${run.id}`} aria-label={`${nextActionLabel(run)}：${run.question}`}>{nextActionLabel(run)} →</Link>
            <details className="run-more-menu">
              <summary aria-label={`更多操作：${run.question}`}>•••</summary>
              <div>
                {confirmId === run.id ? <>
                  <p>删除后无法恢复{run.descendant_count > 0 ? `，并会同时删除 ${run.descendant_count} 条增量研究` : ""}。</p>
                  <button type="button" className="button run-delete-confirm" disabled={busyId === run.id} onClick={() => removeRun(run)}>
                    {busyId === run.id ? "删除中…" : "确认删除"}
                  </button>
                  <button type="button" className="button-quiet" disabled={busyId === run.id} onClick={() => setConfirmId(null)}>取消</button>
                </> : <button type="button" className="button-quiet run-delete" disabled={busyId === run.id} onClick={() => setConfirmId(run.id)}>删除研究</button>}
              </div>
            </details>
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
            <option value="action_priority">按下一步优先</option>
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
        {activeRoots.map((run) => renderRow(run, 0))}
        {dormantRoots.length ? (
          <details className="draft-runs">
            <summary>
              <span>尚未开始的研究（{dormantRoots.length}）</span>
              <small>保留草稿，不占用当前推进列表</small>
            </summary>
            <div className="draft-runs__list">
              {dormantRoots.map((run) => renderRow(run, 0))}
            </div>
          </details>
        ) : null}
        {!forest.roots.length ? (
          <div className="queue-empty" style={{ padding: 24 }}>没有符合筛选条件的研究。</div>
        ) : null}
      </section>
    </>
  );
}
