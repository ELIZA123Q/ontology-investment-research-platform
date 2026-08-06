import "server-only";

import { latestArtifact } from "../../storage/db";
import { extractGraph } from "./instance_graph";
import { loadOntologyCatalog } from "./catalog_loader";
import { loadApprovedSemanticSnapshot } from "./semantic_reads";
import {
  buildStageSemanticContext,
  validateStageSemanticContext,
  type StageSemanticContext,
} from "./semantic_context";
import { parseJson, STAGES, type Artifact, type StageKind } from "../../schemas/types";

export const SEMANTIC_BASELINE_SCHEMA_VERSION = "1.0.0" as const;
export const SEMANTIC_BASELINE_FILE = "semantic_context.yaml";
export const FORMAL_INSTANCE_GRAPH_FILE = "business_instance_graph.yaml";

export type RunSemanticBaseline = {
  schema_name: "controlled_research_semantic_baseline";
  schema_version: typeof SEMANTIC_BASELINE_SCHEMA_VERSION;
  ontology_fingerprint: string;
  ontology_versions: string[];
  resolution_policy: "production_complete";
  instance_graph: {
    artifact: typeof FORMAL_INSTANCE_GRAPH_FILE;
    source_artifact_id: string;
    source_artifact_version: number;
    authority_contract: "ontology_authority_graph_v1";
    projection_fingerprints: Record<string, string>;
  };
  stage_contexts: Record<StageKind, StageSemanticContext>;
};

export function buildProductionSemanticBaseline(
  runId: string,
  stageArtifacts: Record<StageKind, Artifact>,
  stageData: Record<StageKind, Record<string, unknown>>,
): { baseline: RunSemanticBaseline; graphPayload: Record<string, unknown> } {
  const catalog = loadOntologyCatalog();
  const graphArtifact = latestArtifact(runId, "instance_graph", ["approved"]);
  if (!graphArtifact) throw new Error("生产正式包缺少已批准的正式实例图");
  const graphPayload = parseJson<Record<string, unknown>>(graphArtifact.json_content, {});
  if (graphPayload.authority_contract !== "ontology_authority_graph_v1") {
    throw new Error("生产正式包实例图未声明 ontology_authority_graph_v1");
  }
  const graph = extractGraph(graphPayload);
  if (!graph) throw new Error("生产正式包无法解析正式实例图");
  const graphObjectIds = new Set(graph.objects.map((object) => String(object.id)));

  const contexts = {} as Record<StageKind, StageSemanticContext>;
  for (const [index, stage] of STAGES.entries()) {
    // 兼容语义封套功能上线前已批准、但其余正式图谱/阶段合同均有效的运行。
    // 只在导出视图中确定性回投影，不修改已批准原件，也不绕过 complete/fingerprint 门。
    const stored = stageData[stage].semantic_context;
    if (stored) {
      // 已留痕封套即使 partial，也必须自身结构合法且指向当前正式本体；
      // 只能由当前已批准实例图补足任务实例，不能掩盖损坏或过期指纹。
      validateStageSemanticContext(stored, stage, {
        requireComplete: false,
        expectedFingerprint: catalog.fingerprint,
      });
    }
    const candidate = !stored || (stored as Record<string, unknown>).resolution_status !== "complete"
      ? buildStageSemanticContext({
        stage,
        data: stageData[stage],
        upstream: STAGES.slice(0, index).map((upstreamStage) => stageData[upstreamStage]),
        additionalResolvedIds: graphObjectIds,
      })
      : stored;
    contexts[stage] = validateStageSemanticContext(candidate, stage, {
      requireComplete: true,
      expectedFingerprint: catalog.fingerprint,
    });
  }

  const expectedVersions = [...new Set(Object.values(catalog.model_versions).filter(Boolean))].sort();
  for (const stage of STAGES) {
    if (
      contexts[stage].ontology_versions.length !== expectedVersions.length
      || contexts[stage].ontology_versions.some((version, index) => version !== expectedVersions[index])
    ) {
      throw new Error(`${stage}.ontology_versions 与当前正式本体模型版本不一致`);
    }
  }

  for (const stage of ["stage_02", "stage_03", "stage_04"] as const) {
    const snapshot = loadApprovedSemanticSnapshot(runId, stage);
    if (snapshot.authority !== "formal_graph_verified") {
      throw new Error(`${stage} 未通过正式实例图快照门，生产正式包禁止使用历史兼容回退`);
    }
    if (snapshot.artifact.id !== stageArtifacts[stage].id || snapshot.artifact.version !== stageArtifacts[stage].version) {
      throw new Error(`${stage} 正式图快照与待导出产物版本不一致`);
    }
  }

  const projectionFingerprints = graph.projection_fingerprints || {};
  for (const stage of ["stage_02", "stage_03", "stage_04"] as const) {
    if (!/^[a-f0-9]{64}$/.test(String(projectionFingerprints[stage] || ""))) {
      throw new Error(`正式实例图缺少合法的 ${stage} 投影指纹`);
    }
  }

  return {
    baseline: {
      schema_name: "controlled_research_semantic_baseline",
      schema_version: SEMANTIC_BASELINE_SCHEMA_VERSION,
      ontology_fingerprint: catalog.fingerprint,
      ontology_versions: expectedVersions,
      resolution_policy: "production_complete",
      instance_graph: {
        artifact: FORMAL_INSTANCE_GRAPH_FILE,
        source_artifact_id: graphArtifact.id,
        source_artifact_version: graphArtifact.version,
        authority_contract: "ontology_authority_graph_v1",
        projection_fingerprints: { ...projectionFingerprints },
      },
      stage_contexts: contexts,
    },
    graphPayload,
  };
}
