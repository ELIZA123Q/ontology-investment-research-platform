"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { runStatusLabel } from "@/app/lib/ui-labels";

export type RunListItem = {
  id: string;
  question: string;
  domain: string;
  current_stage: number;
  status: string;
  parent_run_id: string | null;
  descendant_count: number;
};

function domainLabel(domain: string) {
  return domain === "semiconductor" ? "半导体" : "通用";
}

export function RunList({ runs }: { runs: RunListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function removeRun(run: RunListItem) {
    const childHint = run.descendant_count > 0
      ? `，并同时删除其 ${run.descendant_count} 条增量研究`
      : "";
    if (!window.confirm(`确定删除「${run.question}」${childHint}？删除后不可恢复。`)) {
      return;
    }
    setBusyId(run.id);
    setError("");
    try {
      const response = await fetch(`/api/runs/${run.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "删除失败");
        return;
      }
      router.refresh();
    } catch {
      setError("删除失败，请稍后重试");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error ? <div className="notice error" style={{ marginBottom: 16 }}>{error}</div> : null}
      <section className="run-list" aria-label="研究列表">
        <div className="run-list-head">
          <span>研究问题</span>
          <span>领域</span>
          <span>进度</span>
          <span></span>
        </div>
        {runs.map((run) => (
          <article className="run-row" key={run.id}>
            <Link className="run-title" href={`/runs/${run.id}`}>
              <strong>{run.question}</strong>
              <span>
                {run.parent_run_id ? "增量运行" : "原始研究"}
                {" · "}
                {runStatusLabel(run.status)}
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
              <button
                type="button"
                className="button-quiet run-delete"
                disabled={busyId === run.id}
                onClick={() => removeRun(run)}
              >
                {busyId === run.id ? "删除中…" : "删除"}
              </button>
              <Link className="row-arrow" href={`/runs/${run.id}`} aria-label={`进入 ${run.question}`}>
                →
              </Link>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
