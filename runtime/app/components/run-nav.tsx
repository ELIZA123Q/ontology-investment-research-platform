"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { RESEARCH_STAGE_JOURNEY, RESEARCH_REFERENCE_SCENES } from "@/app/lib/research-journey";

const stageItems = [
  { id: "overview", label: "概览", path: "", stageKind: null },
  ...RESEARCH_STAGE_JOURNEY.map((stage) => ({
    id: stage.id,
    label: stage.navLabel,
    path: stage.reviewPath,
    stageKind: stage.kind,
  })),
];

const referenceItems = [
  { id: "history" as const, label: "历史", path: "/history" },
  { id: "object-set" as const, label: "实例关系", path: "/object-set" },
  { id: "compare" as const, label: "对照实验", path: "/compare" },
];

export type StageNavStatus = "complete" | "needs_review" | "running" | "blocked" | "idle";

const STATUS_LABEL: Record<StageNavStatus, string> = {
  complete: "已确认",
  needs_review: "待审阅",
  running: "生成中",
  blocked: "受阻",
  idle: "未开始",
};

export function activeSceneFromPath(pathname: string): string {
  if (pathname.includes("/stages/1") || pathname.includes("/scope")) return "scope";
  if (pathname.includes("/stages/2") || pathname.includes("/structure")) return "structure";
  if (pathname.includes("/stages/3") || pathname.includes("/evidence")) return "evidence";
  if (pathname.includes("/stages/4") || pathname.includes("/judgments")) return "judgment";
  if (pathname.includes("/stages/5") || pathname.includes("/report")) return "delivery";
  if (pathname.includes("/compare")) return "compare";
  if (pathname.includes("/history")) return "history";
  if (pathname.includes("/object-set")) return "object-set";
  return "overview";
}

function statusFromSnapshot(data: any, stageKind: string | null): StageNavStatus {
  if (!stageKind) return "idle";
  const stageStatus = data?.manifest?.stages?.[stageKind]?.stage_status;
  if (stageStatus === "complete") return "complete";
  if (stageStatus === "blocked" || stageStatus === "returned") return "blocked";
  const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
  const latest = artifacts.find((item: any) => item.kind === stageKind);
  if (latest?.status === "approved") return "complete";
  if (latest?.status === "running") return "running";
  if (latest?.status === "needs_review") return "needs_review";
  if (latest?.status === "failed") return "blocked";
  const jobs = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data?.active_jobs) ? data.active_jobs : [];
  const job = jobs.find((item: any) => item.stage === stageKind && ["queued", "running", "retrying"].includes(item.status));
  if (job) return "running";
  const workItems = Array.isArray(data?.work_items) ? data.work_items : [];
  if (workItems.some((item: any) => item.stage === stageKind && (item.status === "pending" || item.status === "rework"))) {
    return "needs_review";
  }
  return "idle";
}

export function RunNav({ runId, active }: { runId?: string; active?: string }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname() || "";
  const resolvedRunId = runId || String(params.id || "");
  const resolvedActive = active || activeSceneFromPath(pathname);
  const [statuses, setStatuses] = useState<Record<string, StageNavStatus>>({});
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    if (!resolvedRunId) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/runs/${resolvedRunId}/status`, { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setSyncError(true);
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        const next: Record<string, StageNavStatus> = {};
        for (const item of stageItems) {
          if (!item.stageKind) continue;
          next[item.id] = statusFromSnapshot(data, item.stageKind);
        }
        setStatuses(next);
        setSyncError(false);
      } catch {
        if (!cancelled) setSyncError(true);
      }
    }
    load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [resolvedRunId, pathname]);

  return (
    <nav className="run-scene-nav" aria-label="研究工作场景">
      {stageItems.map((item) => {
        const status = item.stageKind ? (statuses[item.id] || "idle") : null;
        const statusText = status ? STATUS_LABEL[status] : "";
        const ariaLabel = statusText ? `${item.label} · ${statusText}` : item.label;
        return (
          <Link
            key={item.id}
            className={resolvedActive === item.id ? "active" : ""}
            href={`/runs/${resolvedRunId}${item.path}`}
            prefetch
            aria-label={ariaLabel}
            title={ariaLabel}
          >
            {item.label}
            {status ? (
              <>
                <i className={`nav-stage-dot is-${status}`} aria-hidden="true" />
                <small className="nav-stage-status">{statusText}</small>
              </>
            ) : null}
          </Link>
        );
      })}
      <details className={`run-nav-more${referenceItems.some((item) => item.id === resolvedActive) ? " active" : ""}`}>
        <summary aria-label="复盘与审计">复盘与审计</summary>
        <div className="run-nav-more-menu">
          {referenceItems.map((item) => {
            const scene = RESEARCH_REFERENCE_SCENES.find((entry) => entry.id === item.id);
            return (
              <Link
                key={item.id}
                className={resolvedActive === item.id ? "active" : ""}
                href={`/runs/${resolvedRunId}${item.path}`}
                prefetch
                title={scene?.hint || item.label}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </details>
      {syncError ? (
        <span className="nav-sync-warning" role="status" aria-live="polite">状态未同步</span>
      ) : null}
    </nav>
  );
}
