"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function KnowledgeNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const runId = params.get("runId");
  const taskSuffix = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  const task = pathname.startsWith("/90_compat/knowledge/task");
  const items = task ? [
    { href: `/90_compat/knowledge/task/graph${taskSuffix}`, label: "知识图谱", hint: "实体、推理与应用本体" },
    { href: `/90_compat/knowledge/task/applications${taskSuffix}`, label: "实际使用与知识包", hint: "采用记录、任务候选与导出" },
  ] : [
    { href: "/90_compat/knowledge/library/map", label: "知识地图", hint: "结构、热度与候选" },
    { href: "/90_compat/knowledge/library/usage", label: "知识应用", hint: "使用频次与可比性" },
    { href: "/90_compat/knowledge/library/quality", label: "质量检查", hint: "问题、影响与处理" },
    { href: "/90_compat/knowledge/library/gaps", label: "缺口治理", hint: "候选确认与自动入库" },
  ];
  return <>
    <nav className="knowledge-two-tabs" aria-label="知识库一级任务">
      <Link className={task ? "active" : ""} href={`/90_compat/knowledge/task/graph${taskSuffix}`}><strong>研究任务知识</strong><span>理解一项研究如何使用对象、关系、证据与规则</span></Link>
      <Link className={!task ? "active" : ""} href="/90_compat/knowledge/library/map"><strong>整体知识库</strong><span>维护完整本体、知识应用、质量与知识缺口</span></Link>
    </nav>
    <nav className="knowledge-subnav" aria-label={task ? "研究任务知识子页面" : "整体知识库子页面"}>{items.map((item) => <Link className={pathname === item.href.split("?")[0] ? "active" : ""} href={item.href} key={item.href}><strong>{item.label}</strong><span>{item.hint}</span></Link>)}</nav>
  </>;
}
