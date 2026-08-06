import { Suspense } from "react";
import { KnowledgeLegacyRedirect } from "@/app/components/knowledge-legacy-redirect";

export default function KnowledgePage() {
  return <Suspense fallback={<div className="knowledge-selection-empty"><strong>正在打开对应的知识库页面…</strong></div>}><KnowledgeLegacyRedirect /></Suspense>;
}
