"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { HomeIcon, LibraryIcon, SparkIcon } from "@/app/components/icons";

export function AppShell({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const pathname = usePathname();
  return <div className={compact ? "app-frame compact-shell" : "app-frame"}>
    <header className="global-header">
      <Link className="product-mark" href="/" aria-label="判断 AI 投研工作台首页">
        <span className="product-glyph"><SparkIcon /></span>
        <span><strong>判断</strong><small>AI 投研工作台</small></span>
      </Link>
      <nav className="global-nav" aria-label="主导航">
        <Link className={pathname === "/" ? "active" : ""} href="/"><HomeIcon />研究首页</Link>
        <Link className={pathname.startsWith("/library") ? "active" : ""} href="/library"><LibraryIcon />知识库</Link>
      </nav>
      <details className="account-menu">
        <summary aria-label="打开账户菜单"><span>研</span></summary>
        <div><strong>本地研究员</strong><small>本地优先工作区</small><Link href="/admin/knowledge">知识治理控制台</Link></div>
      </details>
    </header>
    {children}
  </div>;
}
