"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const items = [
  { id: "overview", label: "概览", path: "" },
  { id: "scope", label: "范围", path: "/stages/1" },
  { id: "structure", label: "结构", path: "/structure" },
  { id: "evidence", label: "证据", path: "/evidence" },
  { id: "judgment", label: "判断", path: "/judgments" },
  { id: "delivery", label: "交付", path: "/report" },
  { id: "history", label: "历史", path: "/history" },
  { id: "object-set", label: "关系图", path: "/object-set" },
] as const;

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

export function RunNav({ runId, active }: { runId?: string; active?: string }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname() || "";
  const resolvedRunId = runId || String(params.id || "");
  const resolvedActive = active || activeSceneFromPath(pathname);

  return (
    <nav className="run-scene-nav" aria-label="研究工作场景">
      {items.map((item) => (
        <Link
          key={item.id}
          className={resolvedActive === item.id ? "active" : ""}
          href={`/runs/${resolvedRunId}${item.path}`}
          prefetch
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
