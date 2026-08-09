import { ONTOLOGY_CATALOG } from "@/src/ontology/generated";
import type { OntologyActorType, OntologyObjectRef } from "@/src/contracts";

export interface OntologyObjectTypeDefinition {
  id: string;
  labelZh: string;
  description: string;
  attributes: Record<string, { type?: string; required?: boolean; allowed_values?: readonly string[] }>;
  schemaVersion: string;
  namespace: string;
}

export interface OntologyRelationTypeDefinition {
  id: string;
  sourceTypes: readonly string[];
  targetTypes: readonly string[];
  inverseOf?: string | null;
  schemaVersion: string;
}

export interface OntologyActionTypeDefinition {
  version: string;
  label_zh: string;
  description: string;
  target_types: readonly string[];
  parameters: Record<string, { type: string; required: boolean }>;
  allowed_actors: readonly OntologyActorType[];
  reads: readonly string[];
  writes: readonly string[];
  preconditions: readonly string[];
  submission_policy: string;
  function_ref: string | null;
  ontology_edits: readonly string[];
  post_commit_effects: readonly string[];
  approval_policy: { mode: "never" | "always" | "conditional"; kind?: string };
  postconditions: readonly string[];
  idempotency: string;
  conflict_control: string;
  audit_fields: readonly string[];
  compensation: string;
  automation_allowed: boolean;
  handler: string;
}

const objects = ONTOLOGY_CATALOG.objects as unknown as Record<string, OntologyObjectTypeDefinition>;
const relations = ONTOLOGY_CATALOG.relations as unknown as Record<string, OntologyRelationTypeDefinition>;
const actions = ONTOLOGY_CATALOG.actions as unknown as Record<string, OntologyActionTypeDefinition>;
const functions = ONTOLOGY_CATALOG.functions as unknown as Record<string, Record<string, unknown>>;

export class OntologyCatalog {
  readonly platformVersion = ONTOLOGY_CATALOG.platformVersion;
  readonly fingerprint = ONTOLOGY_CATALOG.fingerprint;

  listObjectTypes(): OntologyObjectTypeDefinition[] { return Object.values(objects); }
  listRelationTypes(): OntologyRelationTypeDefinition[] { return Object.values(relations); }
  listActionTypes(): Array<OntologyActionTypeDefinition & { id: string }> {
    return Object.entries(actions).map(([id, definition]) => ({ id, ...definition }));
  }
  listFunctionTypes(): Array<Record<string, unknown> & { id: string }> {
    return Object.entries(functions).map(([id, definition]) => ({ id, ...definition }));
  }
  getObjectType(id: string): OntologyObjectTypeDefinition {
    const found = objects[id];
    if (!found) throw new Error(`Unknown Ontology object type: ${id}`);
    return found;
  }
  getRelationType(id: string): OntologyRelationTypeDefinition {
    const found = relations[id];
    if (!found) throw new Error(`Unknown Ontology relation type: ${id}`);
    return found;
  }
  getActionType(id: string): OntologyActionTypeDefinition {
    const found = actions[id];
    if (!found) throw new Error(`Unknown Ontology action type: ${id}`);
    return found;
  }
  getFunctionType(id: string): Record<string, unknown> {
    const found = functions[id];
    if (!found) throw new Error(`Unknown Ontology function type: ${id}`);
    return found;
  }
  actionsForObject(ref: OntologyObjectRef, actorType: OntologyActorType): Array<OntologyActionTypeDefinition & { id: string }> {
    this.getObjectType(ref.type);
    return this.listActionTypes().filter((action) => action.target_types.includes(ref.type) && action.allowed_actors.includes(actorType));
  }
  assertRelationEndpoints(type: string, source: OntologyObjectRef, target: OntologyObjectRef): void {
    const relation = this.getRelationType(type);
    const sourceAllowed = relation.sourceTypes.includes("ontology_object") || relation.sourceTypes.includes(source.type);
    const targetAllowed = relation.targetTypes.includes("ontology_object") || relation.targetTypes.includes(target.type);
    if (!sourceAllowed || !targetAllowed) throw new Error(`Relation ${type} endpoints are incompatible: ${source.type} -> ${target.type}`);
  }
}

export const ontologyCatalog = new OntologyCatalog();

export type OntologyObjectTypeId = keyof typeof ONTOLOGY_CATALOG.objects;
export type OntologyRelationTypeId = keyof typeof ONTOLOGY_CATALOG.relations;
export type OntologyActionTypeId = keyof typeof ONTOLOGY_CATALOG.actions;
export type OntologyFunctionTypeId = keyof typeof ONTOLOGY_CATALOG.functions;
