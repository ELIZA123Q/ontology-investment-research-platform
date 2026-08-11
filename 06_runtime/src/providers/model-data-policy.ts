import type { SourceReference } from "@/src/contracts";
import type { ModelDataPolicy } from "@/src/providers/model-gateway";

/**
 * Computes the strictest model-egress policy carried by the supplied evidence.
 * Missing provenance or a legacy source without an explicit permission scope is
 * treated as restricted; callers must never silently upgrade unknown data.
 */
export function deriveModelDataPolicy(
  sourceRefs: SourceReference[],
  requiredSourceIds: string[] = [],
  emptyPolicy: ModelDataPolicy = "private_authorized",
): ModelDataPolicy {
  if (!sourceRefs.length) return requiredSourceIds.length ? "restricted_no_egress" : emptyPolicy;
  const byId = new Map(sourceRefs.map((source) => [source.sourceId, source]));
  if (requiredSourceIds.some((id) => !byId.has(id))) return "restricted_no_egress";
  // All supplied references may be serialized into the prompt, even when only a
  // subset is cited by a fact. Therefore the aggregate must include all of them.
  const relevant = sourceRefs;
  if (relevant.some((source) => !source.permissionScope || source.permissionScope === "restricted")) return "restricted_no_egress";
  if (relevant.some((source) => source.permissionScope === "authorized_research_use" || source.permissionScope === "user_supplied")) return "private_authorized";
  return "public";
}
