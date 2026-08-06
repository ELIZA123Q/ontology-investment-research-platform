"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveLegacyKnowledgeRoute } from "@/app/lib/knowledge-routes";

export function KnowledgeLegacyRedirect() {
  const router = useRouter();
  const query = useSearchParams();
  useEffect(() => {
    router.replace(resolveLegacyKnowledgeRoute({ view: query.get("view"), runId: query.get("runId"), hash: window.location.hash }));
  }, [query, router]);
  return <div className="knowledge-selection-empty"><strong>正在打开对应的知识库页面…</strong></div>;
}
