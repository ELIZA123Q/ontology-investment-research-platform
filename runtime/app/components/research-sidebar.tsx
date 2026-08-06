"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

type RunSummary = {
  id: string;
  question: string;
  domain: string;
  status: string;
  current_stage: number;
  updated_at: string;
};

function domainLabel(domain: string): string {
  return domain === "semiconductor" ? "半导体" : domain;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function stageDotClass(stage: number, status: string): string {
  if (status === "complete") return "is-complete";
  if (status === "active") return "is-active-job";
  return "is-idle";
}

function MiniProgressBar({ stage }: { stage: number }) {
  return (
    <div className="research-sidebar-progress" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`research-sidebar-progress-step${
            n <= stage ? " is-complete" : ""
          }`}
        />
      ))}
    </div>
  );
}

export function ResearchSidebar() {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname() || "";
  const resolvedRunId = String(params.id || "");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.runs)
          ? (data.runs as RunSummary[]).sort(
              (a, b) =>
                new Date(b.updated_at).getTime() -
                new Date(a.updated_at).getTime()
            )
          : [];
        setRuns(list);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        className="research-sidebar-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "收起研究列表" : "展开研究列表"}
      >
        {open ? "◂" : "▸"}
      </button>

      {/* Backdrop for mobile */}
      {open ? (
        <div
          className="research-sidebar-backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside className={`research-sidebar${open ? " is-open" : ""}`}>
        <div className="research-sidebar-head">
          <h2>我的研究</h2>
          <Link
            className="research-sidebar-new"
            href="/runs/new"
            title="新建研究"
            aria-label="新建研究"
          >
            +
          </Link>
        </div>

        <nav className="research-sidebar-list" aria-label="研究项目列表">
          {runs.length === 0 ? (
            <p className="muted" style={{ padding: "16px", fontSize: "12px" }}>
              暂无研究项目
            </p>
          ) : (
            runs.map((run) => {
              const isActive = resolvedRunId === run.id;
              return (
                <Link
                  key={run.id}
                  className={`research-sidebar-item${
                    isActive ? " is-active" : ""
                  }`}
                  href={`/runs/${run.id}`}
                  prefetch
                >
                  <span className="research-sidebar-title">{run.question}</span>
                  <span className="research-sidebar-meta">
                    <i
                      className={`research-sidebar-dot ${stageDotClass(
                        run.current_stage,
                        run.status
                      )}`}
                      aria-hidden="true"
                    />
                    {domainLabel(run.domain)} · {formatShortDate(run.updated_at)}
                  </span>
                  <MiniProgressBar stage={run.current_stage} />
                </Link>
              );
            })
          )}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
          <Link
            href="/runs/new"
            className="workspace-quick-action"
            style={{ width: "100%", justifyContent: "center" }}
          >
            新建研究
          </Link>
        </div>
      </aside>
    </>
  );
}
