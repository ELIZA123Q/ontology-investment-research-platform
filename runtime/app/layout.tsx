import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "本体投研工作台",
  description: "以证据、本体与可复盘判断驱动的研究运行工作台",
};

function RadarIcon() {
  return <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 8 12.2 4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
}

function RunsIcon() {
  return <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3.25h10M3 8h10M3 12.75h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="1.5" cy="3.25" r=".75" fill="currentColor"/><circle cx="1.5" cy="8" r=".75" fill="currentColor"/><circle cx="1.5" cy="12.75" r=".75" fill="currentColor"/></svg>;
}

function GraphIcon() {
  return <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="3" r="1.75" stroke="currentColor" strokeWidth="1.4"/><circle cx="13" cy="5" r="1.75" stroke="currentColor" strokeWidth="1.4"/><circle cx="7" cy="13" r="1.75" stroke="currentColor" strokeWidth="1.4"/><path d="m4.6 3.65 6.7.7M4 4.5l2.2 6.9m5.5-5-3.5 5.2" stroke="currentColor" strokeWidth="1.3"/></svg>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brandmark">OR</span>
            <span className="brand-copy"><strong>本体投研工作台</strong><small>证据可复盘的投研工作台</small></span>
          </Link>
          <nav aria-label="主导航">
            <Link href="/"><RadarIcon />研究雷达</Link>
            <Link href="/runs"><RunsIcon />我的研究</Link>
            <Link href="/runs/new">＋ 新建研究</Link>
            <Link href="/ontology"><GraphIcon />知识库</Link>
          </nav>
          <span className="system-state">研究模型：DeepSeek</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
