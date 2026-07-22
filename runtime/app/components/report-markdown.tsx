"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ReportMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
