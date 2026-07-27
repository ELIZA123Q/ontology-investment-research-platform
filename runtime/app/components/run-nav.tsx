"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { RESEARCH_STAGE_JOURNEY } from "@/app/lib/research-journey";

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
  { id: "history", label: "历史", path: "/history", stageKind: null },
  { id: "object-set", label: "关系与审计", path: "/object-set", stageKind: null },
] as const;

export type StageNavStatus = "complete" | "needs_review" | "idle";

export function activeSceneFromPath(pathname: string): string {
  if (pathname.includes("/stages/1") || pathname.includes("/scope")) return "scope";
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
        for (const item of stageItems) {
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
      {stageItems.map((item) => {
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
      <details className={`run-nav-more${referenceItems.some((item) => item.id === resolvedActive) ? " active" : ""}`}>
        <summary>复盘与审计</summary>
        <div className="run-nav-more-menu">
          {referenceItems.map((item) => (
            <Link
              key={item.id}
              className={resolvedActive === item.id ? "active" : ""}
              href={`/runs/${resolvedRunId}${item.path}`}
              prefetch
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
