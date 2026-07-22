"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

function WorkspaceSkeleton() {
  return (
    <div className="workspace-skeleton" aria-busy="true" aria-label="加载阶段工作台">
      <div className="workspace-skeleton-bar" />
      <p className="muted">加载阶段工作台…</p>
    </div>
  );
}

export const StageWorkspaceLazy = dynamic(
  () => import("@/app/components/stage-workspace").then((mod) => mod.StageWorkspace),
  {
    ssr: false,
    loading: () => <WorkspaceSkeleton />,
  },
);

export type StageWorkspaceLazyProps = ComponentProps<typeof StageWorkspaceLazy>;
