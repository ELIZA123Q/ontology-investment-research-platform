export type EvidenceQuickFilter = "all" | "pending" | "gaps" | "changes";

export function matchesEvidenceQuickFilter(input: {
  filter: EvidenceQuickFilter;
  kind: string;
  workStatus?: string | null;
  changed?: boolean;
}): boolean {
  if (input.filter === "pending") return !input.workStatus || ["pending", "rework"].includes(input.workStatus);
  if (input.filter === "gaps") return ["gap", "conflict"].includes(input.kind);
  if (input.filter === "changes") return Boolean(input.changed);
  return true;
}

export function sortByEvidencePriority<T extends { id: string }>(items: T[], priorityIds: string[]): T[] {
  const order = new Map(priorityIds.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const aIndex = order.get(a.id);
    const bIndex = order.get(b.id);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return 0;
  });
}
