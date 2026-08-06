import { Suspense } from "react";
import { KnowledgeNav } from "@/app/components/knowledge-nav";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return <><div className="pagehead knowledge-pagehead"><div><div className="eyebrow">知识库</div><h1>从研究问题理解知识，再维护可复用的整体本体</h1><p className="muted">每个页面只回答一个问题；图谱负责解释对象如何连接，明细负责解释知识如何被使用和治理。</p></div></div><Suspense><KnowledgeNav /></Suspense>{children}</>;
}
