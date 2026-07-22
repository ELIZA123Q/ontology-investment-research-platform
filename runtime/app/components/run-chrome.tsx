"use client";

import type { ReactNode } from "react";
import { useParams, usePathname } from "next/navigation";
import { RunNav, activeSceneFromPath } from "@/app/components/run-nav";
import { RunRevisePanel } from "@/app/components/run-revise-panel";

export function RunChrome({
  runId,
  active,
  children,
}: {
  runId?: string;
  active?: string;
  children?: ReactNode;
}) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname() || "";
  const resolvedRunId = runId || String(params.id || "");
  const resolvedActive = active || activeSceneFromPath(pathname);

  if (!resolvedRunId) return children ? <>{children}</> : null;

  return <>
    <RunNav runId={resolvedRunId} active={resolvedActive} />
    {children}
    <RunRevisePanel runId={resolvedRunId} active={resolvedActive} />
  </>;
}
