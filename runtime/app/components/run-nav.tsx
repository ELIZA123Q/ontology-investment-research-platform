"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";

const items = [
  { id: "overview", label: "概览", path: "", stageKind: null },
  { id: "scope", label: "范围", path: "/stages/1", stageKind: "stage_01" },
  { id: "structure", label: "结构", path: "/structure", stageKind: "stage_02" },
  { id: "evidence", label: "证据", path: "/evidence", stageKind: "stage_03" },
  { id: "judgment", label: "判断", path: "/judgments", stageKind: "stage_04" },
  { id: "delivery", label: "交付", path: "/report", stageKind: "stage_05" },
] as const;

export type StageNavStatus = "complete" | "needs_review" | "idle";

export function activeSceneFromPath(pathname: string): string {
  if (pathname.includes("/stages/1")) return "scope";
  if (pathname.includes("/stages/2") || pathname.includes("/structure")) return "structure";
  if (pathname.includes("/stages/3") || pathname.includes("/evidence")) return "evidence";
  if (pathname.includes("/stages/4") || pathname.includes("/judgments")) return "judgment";
  if (pathname.includes("/stages/5") || pathname.includes("/report") || pathname.includes("/compare")) return "delivery";
  if (pathname.includes("/history")) return "history";
  if (pathname.includes("/object-set")) return "object-set";
  return "overview";
}

function statusFromSnapshot(data: any, stageKind: string | null): StageNavStatus {
  if (!stageKind) return "idle";
  const stageStatus = data?.manifest?.stages?.[stageKind]?.stage_status;
  if (stageStatus === "complete") return "complete";
  const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
  const latest = artifacts.find((item: any) => item.kind === stageKind);
  if (latest?.status === "needs_review") return "needs_review";
  return "idle";
}

export function RunNav({ runId, active }: { runId?: string; active?: string }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname() || "";
  const resolvedRunId = runId || String(params.id || "");
  const resolvedActive = active || activeSceneFromPath(pathname);
  const [statuses, setStatuses] = useState<Record<string, StageNavStatus>>({});

  useEffect(() => {
    if (!resolvedRunId) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/runs/${resolvedRunId}/status`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const next: Record<string, StageNavStatus> = {};
        for (const item of items) {
          if (!item.stageKind) continue;
          next[item.id] = statusFromSnapshot(data, item.stageKind);
        }
        setStatuses(next);
      } catch {
        // ignore polling errors
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
      {items.map((item) => {
        const status = item.stageKind ? (statuses[item.id] || "idle") : null;
        return (
          <Link
            key={item.id}
            className={resolvedActive === item.id ? "active" : ""}
            href={`/runs/${resolvedRunId}${item.path}`}
            prefetch
          >
            {item.label}
            {status ? <i className={`nav-stage-dot is-${status}`} aria-hidden="true" /> : null}
          </Link>
        );
      })}
      <details className="run-nav-more">
        <summary aria-label="更多">⋯</summary>
        <div className="run-nav-more-menu">
          <Link href={`/runs/${resolvedRunId}/history`} className={resolvedActive === "history" ? "active" : ""}>历史</Link>
          <Link href={`/runs/${resolvedRunId}/object-set`} className={resolvedActive === "object-set" ? "active" : ""}>关系图</Link>
        </div>
      </details>
    </nav>
  );
}
