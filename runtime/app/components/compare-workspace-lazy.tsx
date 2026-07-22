"use client";

import dynamic from "next/dynamic";

export const CompareWorkspaceLazy = dynamic(
  () => import("@/app/components/compare-workspace").then((mod) => mod.CompareWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="workspace-skeleton" aria-busy="true">
        <div className="workspace-skeleton-bar" />
        <p className="muted">加载对照工作台…</p>
      </div>
    ),
  },
);
