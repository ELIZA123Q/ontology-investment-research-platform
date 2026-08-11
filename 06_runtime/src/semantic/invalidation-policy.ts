import type { OntologyLink, OntologyObjectRef } from "@/src/contracts";
import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";
import type { OntologyStore } from "@/src/ontology/store";

const directions = DOMAIN_CATALOG.tracePolicy.downstream_invalidation.directions as Record<string, "forward" | "reverse">;

/** Traverse only relation directions declared by the 01 knowledge-graph authority. */
export function traceReachableDownstream(store: OntologyStore, roots: OntologyObjectRef[]): OntologyObjectRef[] {
  const visited = new Map(roots.map((ref) => [ref.id, ref]));
  const queue = roots.map((ref) => ref.id);
  while (queue.length) {
    const current = queue.shift()!;
    for (const link of store.listLinksForObject(current)) {
      const direction = directions[link.type];
      if (!direction) continue;
      const next = nextRef(link, current, direction);
      if (!next || visited.has(next.id)) continue;
      visited.set(next.id, next);
      queue.push(next.id);
    }
  }
  return [...visited.values()].filter((ref) => !roots.some((root) => root.id === ref.id));
}

function nextRef(link: OntologyLink, current: string, direction: "forward" | "reverse"): OntologyObjectRef | null {
  if (direction === "forward" && link.sourceRef.id === current) return link.targetRef;
  if (direction === "reverse" && link.targetRef.id === current) return link.sourceRef;
  return null;
}
