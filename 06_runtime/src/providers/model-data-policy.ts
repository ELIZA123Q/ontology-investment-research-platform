import type { SourceReference } from "@/src/contracts";
import type { ModelDataPolicy } from "@/src/providers/model-gateway";
import { MODEL_DATA_EGRESS_RULES } from "@/src/providers/generated/model-data-egress-rules";

const policyForPermission = (permissionScope?: SourceReference["permissionScope"]): ModelDataPolicy => {
  const mapping = MODEL_DATA_EGRESS_RULES.source_permission_mapping as Record<string, ModelDataPolicy>;
  return mapping[permissionScope || "missing_permission_scope"] || mapping.missing_permission_scope;
};

const strictestPolicy = (policies: ModelDataPolicy[]): ModelDataPolicy => {
  const precedence = MODEL_DATA_EGRESS_RULES.aggregation.precedence as readonly ModelDataPolicy[];
  return precedence.find((policy) => policies.includes(policy)) || (MODEL_DATA_EGRESS_RULES.aggregation.no_source_behavior as ModelDataPolicy);
};

/**
 * Computes the strictest model-egress policy carried by the supplied evidence.
 * Missing provenance or a legacy source without an explicit permission scope is
 * treated as restricted; callers must never silently upgrade unknown data.
 */
export function deriveModelDataPolicy(
  sourceRefs: SourceReference[],
  requiredSourceIds: string[] = [],
  emptyPolicy?: ModelDataPolicy,
): ModelDataPolicy {
  const aggregation = MODEL_DATA_EGRESS_RULES.aggregation;
  if (!sourceRefs.length) return requiredSourceIds.length ? aggregation.required_source_missing_behavior : (emptyPolicy || aggregation.no_source_behavior) as ModelDataPolicy;
  const byId = new Map(sourceRefs.map((source) => [source.sourceId, source]));
  if (requiredSourceIds.some((id) => !byId.has(id))) return aggregation.required_source_missing_behavior as ModelDataPolicy;
  // All supplied references may be serialized into the prompt, even when only a
  // subset is cited by a fact. Therefore the aggregate must include all of them.
  return strictestPolicy(sourceRefs.map((source) => policyForPermission(source.permissionScope)));
}
