import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata:Metadata={title:"Ontology Research Workbench",description:"本体约束的投研判断工作台"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><header className="topbar"><Link href="/" className="brand"><span className="brandmark">OR</span><span>Ontology Research Workbench</span></Link><nav><Link href="/">研究运行</Link><Link href="/ontology">本体浏览器</Link></nav></header><main>{children}</main></body></html>}
