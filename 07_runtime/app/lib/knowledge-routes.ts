export function resolveLegacyKnowledgeRoute(input: { view?: string | null; runId?: string | null; hash?: string | null }) {
  const hash = String(input.hash || "").replace(/^#/, "");
  let route = "/90_compat/knowledge/task/graph";
  if (input.view === "library") route = ({ usage: "/90_compat/knowledge/library/usage", quality: "/90_compat/knowledge/library/quality", gaps: "/90_compat/knowledge/library/gaps", "ontology-graph": "/90_compat/knowledge/library/map" } as Record<string, string>)[hash] || "/90_compat/knowledge/library/map";
  else if (hash === "applications") route = "/90_compat/knowledge/task/applications";
  return `${route}${input.runId && route.startsWith("/90_compat/knowledge/task") ? `?runId=${encodeURIComponent(input.runId)}` : ""}`;
}
