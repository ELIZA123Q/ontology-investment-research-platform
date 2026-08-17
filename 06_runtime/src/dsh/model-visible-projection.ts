import type { Artifact, SourceReference } from "@/src/contracts/evidence";
import { deriveModelDataPolicy } from "@/src/providers/model-data-policy";

type ModelVisibleArtifact = Omit<Artifact, "data" | "sourceRefs"> & {
  data: unknown;
  sourceRefs: SourceReference[];
  modelDataPolicy: "public" | "private_authorized" | "restricted_no_egress";
};

function projectArtifact(artifact: Artifact): ModelVisibleArtifact {
  const modelDataPolicy = deriveModelDataPolicy(artifact.sourceRefs);
  if (modelDataPolicy === "restricted_no_egress") {
    return {
      ...artifact,
      data: { withheld: true, reason: "Source permission policy forbids external-model egress" },
      sourceRefs: [],
      modelDataPolicy,
    };
  }
  return { ...artifact, modelDataPolicy };
}

/**
 * DSH's official DeepSeek adapter sends tool results back to an external model.
 * The domain gateway therefore projects the existing snapshot before it reaches
 * the harness, withholding any artifact that carries restricted provenance.
 */
export function projectResearchCaseSnapshotForDsh<T extends {
  runtime: { artifacts: Artifact[]; messages?: unknown; events?: unknown; [key: string]: unknown };
}>(snapshot: T): Omit<T, "runtime"> & { runtime: Omit<T["runtime"], "artifacts" | "messages" | "events"> & { artifacts: ModelVisibleArtifact[] } } {
  const { artifacts, messages: _messages, events: _events, ...runtime } = snapshot.runtime;
  return { ...snapshot, runtime: { ...runtime, artifacts: artifacts.map(projectArtifact) } };
}
