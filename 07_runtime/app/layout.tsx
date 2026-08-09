import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "投研判断工作台 vNext",
  description: "本地优先、目标驱动的投研研究搭档",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
