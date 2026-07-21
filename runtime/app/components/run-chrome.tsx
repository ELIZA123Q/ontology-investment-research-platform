import type { ReactNode } from "react";
import { RunNav } from "@/app/components/run-nav";
import { RunRevisePanel } from "@/app/components/run-revise-panel";

export function RunChrome({
  runId,
  active,
  children,
}: {
  runId: string;
  active: string;
  children?: ReactNode;
}) {
  return <>
    <RunNav runId={runId} active={active} />
    {children}
    <RunRevisePanel runId={runId} active={active} />
  </>;
}
