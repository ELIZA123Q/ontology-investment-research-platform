"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareReaderReportMarkdown } from "@/app/lib/researcher-stage-output";

export function ReportMarkdown({ content, readerView = false }: { content: string; readerView?: boolean }) {
  const rendered = readerView ? prepareReaderReportMarkdown(content) : content;
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{rendered}</ReactMarkdown>;
}
