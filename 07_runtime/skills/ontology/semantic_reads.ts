import "server-only";
import { getRun, latestArtifact } from "../../storage/db";
import {
  authorityStageProjectionFingerprint,
  loadGraphForRun,
  mergeStageJsonWithGraphProjection,
  type AuthorityGraphStage,
} from "./instance_graph";
import { parseJson, type Artifact } from "../../schemas/types";

export type ApprovedSemanticSnapshot = {
  artifact: Artifact;
  data: Record<string, any>;
  authority: "formal_graph_verified" | "legacy_artifact_fallback";
  graph_artifact_source: string | null;
  /** true when stage JSON sections were rebuilt from the instance graph (new-run read surface). */
  read_from_graph_projection?: boolean;
};

/**
 * 读取不可变的已确认阶段快照。
 * - 无正式图：legacy 回落，直接读阶段 artifact JSON。
 * - 有正式图且指纹一致：读面优先从图投影阶段 JSON（单向）；artifact 仅用于指纹校验与 compat 字段。
 * 禁止阶段 JSON ↔ 图双向手工同步。
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
      read_from_graph_projection: false,
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
      read_from_graph_projection: false,
    };
  }
  if (actual !== expected) {
    throw new Error(`${kind} 已批准快照与正式实例图指纹不一致，必须重建图谱后再读取`);
  }

  const projected = mergeStageJsonWithGraphProjection(data, loaded.graph, kind);
  return {
    artifact,
    data: projected,
    authority: "formal_graph_verified",
    graph_artifact_source: loaded.source,
    read_from_graph_projection: true,
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
