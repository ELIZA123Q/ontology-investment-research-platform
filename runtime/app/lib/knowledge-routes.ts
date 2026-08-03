export function resolveLegacyKnowledgeRoute(input: { view?: string | null; runId?: string | null; hash?: string | null }) {
  const hash = String(input.hash || "").replace(/^#/, "");
  let route = "/knowledge/task/graph";
  if (input.view === "library") route = ({ usage: "/knowledge/library/usage", quality: "/knowledge/library/quality", gaps: "/knowledge/library/gaps", "ontology-graph": "/knowledge/library/map" } as Record<string, string>)[hash] || "/knowledge/library/map";
  else if (hash === "applications") route = "/knowledge/task/applications";
  return `${route}${input.runId && route.startsWith("/knowledge/task") ? `?runId=${encodeURIComponent(input.runId)}` : ""}`;
}
