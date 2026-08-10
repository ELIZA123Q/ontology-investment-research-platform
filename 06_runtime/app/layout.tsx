import type { Metadata } from "next";
import "./styles/tokens.css";
import "./globals.css";
import "./styles/layout.css";
import "./styles/components.css";

export const metadata: Metadata = {
  title: "判断 · AI 投研工作台",
  description: "从研究问题到可核验判断的 AI 原生工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
