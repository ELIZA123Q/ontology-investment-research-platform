import { redirect } from "next/navigation";

/**
 * 旧知识库地址兼容层。知识浏览与治理现已合并进 /knowledge 的两个一级任务。
 */
export default async function LegacyOntologyPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; runId?: string; queryRunId?: string; node?: string }>;
}) {
  const q = await searchParams;
  const libraryTabs = new Set(["governance", "comparability"]);
  if (libraryTabs.has(String(q.tab || ""))) {
    redirect(q.tab === "governance" ? "/90_compat/knowledge/library/gaps" : "/90_compat/knowledge/library/usage");
  }
  const runId = q.runId || q.queryRunId;
  const route = q.tab === "queries" ? "/90_compat/knowledge/task/applications" : "/90_compat/knowledge/task/graph";
  redirect(`${route}${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`);
}
