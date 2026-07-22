"use client";

import dynamic from "next/dynamic";

function GraphSkeleton({ message = "加载关系图…" }: { message?: string }) {
  return (
    <div className="graph-skeleton" aria-busy="true" aria-label={message}>
      <div className="graph-skeleton-grid" />
      <span>{message}</span>
    </div>
  );
}

export const ResearchGraphLazy = dynamic(
  () => import("@/app/components/research-graph").then((mod) => mod.ResearchGraph),
  {
    ssr: false,
    loading: () => <GraphSkeleton />,
  },
);
