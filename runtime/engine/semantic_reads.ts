import "server-only";
import { getRun, latestArtifact } from "../adapters/db";
import {
  authorityStageProjectionFingerprint,
  loadGraphForRun,
  type AuthorityGraphStage,
} from "./instance_graph";
import { parseJson, type Artifact } from "./types";

export type ApprovedSemanticSnapshot = {
  artifact: Artifact;
  data: Record<string, any>;
  authority: "formal_graph_verified" | "legacy_artifact_fallback";
  graph_artifact_source: string | null;
};

/**
 * 读取不可变的已确认阶段快照。当前正式图存在时，阶段快照必须与图中记录的
 * 产物指纹完全一致；这允许历史阶段数据继续承载“当时状态”，但禁止其绕过
 * 实例图权威而静默漂移。
 */
export function loadApprovedSemanticSnapshot(
  runId: string,
  kind: AuthorityGraphStage,
): ApprovedSemanticSnapshot {
  const artifact = latestArtifact(runId, kind, ["approved"]);
  if (!artifact) throw new Error(`缺少已批准的 ${kind}`);
  const data = parseJson<Record<string, any>>(artifact.json_content, {});
  const run = getRun(runId);
  const loaded = loadGraphForRun(runId, run?.package_path);
  if (loaded.authority !== "formal") {
    return {
      artifact,
      data,
      authority: "legacy_artifact_fallback",
      graph_artifact_source: null,
    };
  }

  const expected = authorityStageProjectionFingerprint({
    kind,
    artifact_id: artifact.id,
    artifact_version: artifact.version,
    data,
  });
  const actual = loaded.graph.projection_fingerprints?.[kind];
  if (!actual) {
    const graphArtifact = latestArtifact(runId, "instance_graph", ["approved", "needs_review"]);
    const graphPayload = parseJson<Record<string, any>>(graphArtifact?.json_content || "{}", {});
    if (graphPayload.authority_contract === "ontology_authority_graph_v1") {
      throw new Error(`正式实例图缺少 ${kind} 投影指纹，禁止绕过图权威读取阶段快照`);
    }
    return {
      artifact,
      data,
      authority: "legacy_artifact_fallback",
      graph_artifact_source: loaded.source,
    };
  }
  if (actual !== expected) {
    throw new Error(`${kind} 已批准快照与正式实例图指纹不一致，必须重建图谱后再读取`);
  }
  return {
    artifact,
    data,
    authority: "formal_graph_verified",
    graph_artifact_source: loaded.source,
  };
}

export function approvedSemanticData(runId: string, kind: AuthorityGraphStage): Record<string, any> {
  return loadApprovedSemanticSnapshot(runId, kind).data;
}

export function approvedSemanticDataIfPresent(
  runId: string,
  kind: AuthorityGraphStage,
): Record<string, any> | null {
  if (!latestArtifact(runId, kind, ["approved"])) return null;
  return approvedSemanticData(runId, kind);
}
