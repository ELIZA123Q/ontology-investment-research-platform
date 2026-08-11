import { ONTOLOGY_CATALOG } from "@/src/ontology/generated";
import type { AccessContext, OntologyLink, OntologyObject, OntologyObjectRef } from "@/src/contracts";
import { ontologyCatalog } from "@/src/ontology/catalog";
import { OntologyStore } from "@/src/ontology/store";

export interface OntologyQuery {
  typeOrInterface?: string;
  filters?: Record<string, unknown>;
  asOf?: string;
  accessContext: AccessContext;
  limit?: number;
}

export interface OntologyTraversalQuery {
  sourceRefs: OntologyObjectRef[];
  linkType: string;
  /** API side name or `source`/`target`; target side traverses reverse. */
  side?: string;
  asOf?: string;
  accessContext: AccessContext;
}

export interface OntologyAggregateQuery extends OntologyQuery {
  measures: Array<{ op: "count" | "sum" | "avg"; property?: string; as: string }>;
  groupBy?: string[];
}

export interface BaselineRelease {
  domain: string;
  schemaVersion?: string;
  sourceOfTruth?: string[];
  catalogFingerprint: string;
  objectCount: number;
  relationCount: number;
}

const activeScope = (value: unknown) => typeof value === "string" ? value : "public";
const property = (value: Record<string, unknown>, key: string) => key.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, value);
const temporalValue = (value: Record<string, unknown>) => value.cutoff_at || value.as_of || value.valid_from || value.published_at;

export function canRead(properties: Record<string, unknown>, context: AccessContext): boolean {
  const scope = activeScope(properties.access_scope);
  if (scope === "public") return true;
  const grants = new Set([...(context.accessScopes || []), ...(context.entitlements || []), ...(context.groups || [])]);
  if (grants.has(scope) || grants.has("*") || grants.has("ontology:read_all")) return true;
  if (scope === "internal") return context.actorType === "researcher" || context.actorType === "system" || context.actorType === "ontology_admin";
  return scope === "private" && (properties.owner_id === context.actorId || properties.created_by === context.actorId);
}

function matches(properties: Record<string, unknown>, filters: Record<string, unknown> | undefined): boolean {
  return !filters || Object.entries(filters).every(([key, expected]) => {
    const actual = property(properties, key);
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

function inTime(properties: Record<string, unknown>, asOf: string | undefined): boolean {
  if (!asOf) return true;
  const time = temporalValue(properties);
  return typeof time !== "string" || time <= asOf;
}

/**
 * Read side for ontology objects. Bundled domain instances are immutable baseline
 * data; formal Action writes are the overlay. The service never reads YAML at
 * runtime, only the generated catalog projection.
 */
export class OntologyQueryService {
  constructor(private readonly overlay: OntologyStore) {}

  releases(): BaselineRelease[] {
    const bundles = ONTOLOGY_CATALOG.domainBundles as unknown as Record<string, { schema_version?: string; authority?: string; objects?: unknown[]; relations?: unknown[] }>;
    return Object.entries(bundles).map(([domain, graph]) => ({
      domain, schemaVersion: graph.schema_version, sourceOfTruth: graph.authority ? [graph.authority] : undefined,
      catalogFingerprint: ontologyCatalog.fingerprint, objectCount: graph.objects?.length || 0, relationCount: graph.relations?.length || 0,
    }));
  }

  queryObjects(query: OntologyQuery): OntologyObject[] {
    const acceptedTypes = query.typeOrInterface
      ? this.resolveTypes(query.typeOrInterface)
      : null;
    const objects = [...this.baselineObjects(), ...this.overlay.listObjects()];
    return objects
      .filter((item) => !acceptedTypes || acceptedTypes.has(item.type))
      .filter((item) => canRead(item.properties, query.accessContext))
      .filter((item) => inTime(item.properties, query.asOf))
      .filter((item) => matches(item.properties, query.filters))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, query.limit || 100);
  }

  traverseLinks(query: OntologyTraversalQuery): Array<{ link: OntologyLink; object: OntologyObject }> {
    // Domain bundles can introduce governed parameter links (for example a
    // StateVariable-to-EvidenceProfile binding) without turning each parameter
    // association into a globally writable relation type. They remain read-only
    // baseline links and use source/target sides until promoted to a catalog type.
    const relation = (() => { try { return ontologyCatalog.getRelationType(query.linkType); } catch { return undefined; } })();
    const reverse = query.side === "target" || (relation ? query.side === relation.targetSide : false);
    const inputIds = new Set(query.sourceRefs.map((ref) => ref.id));
    const byId = new Map([...this.baselineObjects(), ...this.overlay.listObjects()].map((item) => [item.id, item]));
    return [...this.baselineLinks(), ...this.overlayLinks()]
      .filter((link) => link.type === query.linkType)
      .filter((link) => inputIds.has(reverse ? link.targetRef.id : link.sourceRef.id))
      .map((link) => ({ link, object: byId.get(reverse ? link.sourceRef.id : link.targetRef.id) }))
      .filter((item): item is { link: OntologyLink; object: OntologyObject } => Boolean(item.object))
      .filter((item) => canRead(item.object.properties, query.accessContext) && inTime(item.object.properties, query.asOf));
  }

  aggregateObjects(query: OntologyAggregateQuery): Array<Record<string, string | number | null>> {
    const groups = new Map<string, { keys: Record<string, string | number | null>; values: OntologyObject[] }>();
    for (const object of this.queryObjects(query)) {
      const keys = Object.fromEntries((query.groupBy || []).map((key) => [key, property(object.properties, key) as string | number | null]));
      const id = JSON.stringify(keys);
      const group = groups.get(id) || { keys, values: [] };
      group.values.push(object); groups.set(id, group);
    }
    return [...groups.values()].map(({ keys, values }) => ({ ...keys, ...Object.fromEntries(query.measures.map((measure) => {
      const measureProperty = measure.property;
      const numbers = measureProperty ? values.map((item) => Number(property(item.properties, measureProperty))).filter(Number.isFinite) : [];
      const value = measure.op === "count" ? values.length : measure.op === "sum" ? numbers.reduce((sum, item) => sum + item, 0) : numbers.length ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length : null;
      return [measure.as, value];
    })) }));
  }

  traceJudgment(judgmentRef: string, direction: "upstream" | "downstream", accessContext: AccessContext): { objects: OntologyObject[]; links: OntologyLink[] } {
    const allObjects = new Map([...this.baselineObjects(), ...this.overlay.listObjects()].map((item) => [item.id, item]));
    const allLinks = [...this.baselineLinks(), ...this.overlayLinks()];
    const visited = new Set<string>([judgmentRef]);
    const links: OntologyLink[] = [];
    const queue = [judgmentRef];
    while (queue.length) {
      const current = queue.shift()!;
      for (const link of allLinks) {
        const next = direction === "upstream" ? (link.sourceRef.id === current ? link.targetRef.id : undefined) : (link.targetRef.id === current ? link.sourceRef.id : undefined);
        if (!next || visited.has(next)) continue;
        const object = allObjects.get(next);
        if (!object || !canRead(object.properties, accessContext)) continue;
        visited.add(next); queue.push(next); links.push(link);
      }
    }
    return { objects: [...visited].map((id) => allObjects.get(id)).filter((item): item is OntologyObject => Boolean(item)), links };
  }

  private resolveTypes(typeOrInterface: string): Set<string> {
    try { ontologyCatalog.getObjectType(typeOrInterface); return new Set([typeOrInterface]); }
    catch { return new Set(ontologyCatalog.objectTypesForInterface(typeOrInterface).map((item) => item.id)); }
  }

  private baselineObjects(): OntologyObject[] {
    const bundles = ONTOLOGY_CATALOG.domainBundles as unknown as Record<string, { objects?: Array<{ id: string; type: string; properties?: Record<string, unknown> }> }>;
    return Object.values(bundles).flatMap((graph) => (graph.objects || []).map((item) => ({
      id: item.id, type: item.type, version: 1, status: "active" as const, properties: { ...(item.properties || {}), ontology_origin: "baseline" }, createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    })));
  }

  private baselineLinks(): OntologyLink[] {
    const bundles = ONTOLOGY_CATALOG.domainBundles as unknown as Record<string, { relations?: Array<{ id: string; type: string; sourceId: string; targetId: string; properties?: Record<string, unknown> }> }>;
    const types = new Map(this.baselineObjects().map((item) => [item.id, item.type]));
    return Object.values(bundles).flatMap((graph) => (graph.relations || []).map((item) => ({
      id: item.id, type: item.type, sourceRef: { id: item.sourceId, type: types.get(item.sourceId) || "ontology_object" }, targetRef: { id: item.targetId, type: types.get(item.targetId) || "ontology_object" }, version: 1,
      properties: item.properties || {}, createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    })));
  }

  private overlayLinks(): OntologyLink[] {
    return this.overlay.listObjects().flatMap((object) => this.overlay.listLinksForObject(object.id)).filter((link, index, all) => all.findIndex((item) => item.id === link.id) === index);
  }
}
