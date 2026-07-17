import "server-only";
import {
  approveArtifact,
  createArtifact,
  getArtifact,
  getRun,
  latestArtifact,
  listSources,
  saveInstanceGraph,
  supersedeDownstream,
  updateArtifact,
  upsertSource,
} from "../adapters/db";
import { loadKnowledge } from "./knowledge";
import { ResearchModelClient } from "../adapters/openai";
import { promptFor, PROMPT_VERSION } from "./prompts";
import { schemas, type SchemaKind } from "./schemas";
import { ontologyContextForPrompt } from "./ontology_tools";
import { emptyGraph, loadGraphForRun, materializeStageIntoGraph } from "./instance_graph";
import { parseJson, STAGES, type Artifact, type ArtifactKind, type StageKind } from "./types";

function stageNumber(kind: ArtifactKind) {
  return kind.startsWith("stage_") ? Number(kind.slice(-2)) : 0;
}

export function validateApproval(artifact: Artifact) {
  const schema = schemas[artifact.kind as SchemaKind];
  if (schema) schema.parse(parseJson(artifact.json_content, {}));
  const data: any = parseJson(artifact.json_content, {});
  if (artifact.kind === "stage_03") {
    const known = new Set(listSources(artifact.run_id).map((s) => s.id));
    for (const evidence of data.evidence_drafts || []) {
      if (evidence.kind !== "gap" && (!evidence.source_ids?.length || evidence.source_ids.some((id: string) => !known.has(id)))) {
        throw new Error(`${evidence.id} 缺少有效来源，不能确认`);
      }
    }
  }
  if (artifact.kind === "stage_04") {
    const upstream: any = parseJson(latestArtifact(artifact.run_id, "stage_03", ["approved"])?.json_content || "{}", {});
    const ids = new Set((upstream.evidence_drafts || []).map((x: any) => x.id));
    for (const j of data.judgments || []) {
      for (const id of [...j.supporting_evidence_draft_ids, ...j.counter_evidence_draft_ids]) {
        if (!ids.has(id)) throw new Error(`${j.id} 引用了不存在的证据草稿 ${id}`);
      }
    }
  }
  if (artifact.kind === "stage_05") {
    const upstream: any = parseJson(latestArtifact(artifact.run_id, "stage_04", ["approved"])?.json_content || "{}", {});
    const ids = new Set((upstream.judgments || []).map((x: any) => x.id));
    const sourceIds = new Set(listSources(artifact.run_id).map((s) => s.id));
    for (const c of data.report_claims || []) {
      for (const id of c.judgment_ids) if (!ids.has(id)) throw new Error(`${c.id} 引用了不存在的判断 ${id}`);
      for (const id of c.source_ids) if (!sourceIds.has(id)) throw new Error(`${c.id} 引用了不存在的来源 ${id}`);
    }
  }
}

export function approve(id: string) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error("产物不存在");
  if (artifact.status !== "needs_review") throw new Error("只有待确认产物可以确认");
  validateApproval(artifact);
  approveArtifact(artifact);
  if (["stage_02", "stage_03", "stage_04"].includes(artifact.kind)) {
    materializeAuthorityGraph(artifact.run_id, artifact.kind, parseJson(artifact.json_content, {}));
  }
  return getArtifact(id)!;
}

function materializeAuthorityGraph(runId: string, stageKind: string, stageJson: Record<string, unknown>) {
  const run = getRun(runId);
  if (!run) return;
  const loaded = loadGraphForRun(runId, run.package_path);
  const base =
    loaded.authority === "formal" || loaded.authority === "package"
      ? loaded.graph
      : emptyGraph();
  const next = materializeStageIntoGraph(
    { ...base, authority: "business_parameters" },
    stageKind,
    stageJson,
  );
  saveInstanceGraph(
    runId,
    {
      provisional: false,
      materialized_from: stageKind,
      materialized_at: new Date().toISOString(),
      business_instance_graph: next,
    },
    `materialized from ${stageKind}`,
  );
}

export async function generateArtifact(runId: string, kind: ArtifactKind) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (kind.startsWith("stage_")) {
    const n = stageNumber(kind);
    if (n > 1 && !latestArtifact(runId, STAGES[n - 2], ["approved"])) {
      throw new Error(`请先确认阶段 ${String(n - 1).padStart(2, "0")}`);
    }
  }
  const knowledge = kind.startsWith("stage_") ? loadKnowledge(kind as StageKind) : { version: "none", context: "", files: [] };
  const upstream = STAGES.filter((s) => stageNumber(s) < stageNumber(kind))
    .map((s) => latestArtifact(runId, s, ["approved"]))
    .filter(Boolean)
    .map((a) => ({ kind: a!.kind, json: parseJson(a!.json_content, {}) }));
  const sources = listSources(runId);
  const ontologyContext = ontologyContextForPrompt(runId);
  const inputContext = JSON.stringify(
    {
      question: run.question,
      domain: run.domain,
      package_path: run.package_path,
      upstream,
      sources,
      ontology_object_set: ontologyContext,
      knowledge_files: knowledge.files,
      knowledge_context: knowledge.context,
    },
    null,
    2,
  );
  const artifact = createArtifact(runId, kind, {
    status: "running",
    prompt_version: PROMPT_VERSION,
    knowledge_version: knowledge.version,
    input_context: inputContext,
  });
  try {
    const client = new ResearchModelClient();
    const useOntologyTools = kind === "stage_03" || kind === "stage_04";
    const result = await client.generate(kind as SchemaKind, promptFor(kind), inputContext, {
      webSearch: kind === "stage_03" || kind === "baseline",
      ontologyTools: useOntologyTools,
      runId,
    });
    const data: any = result.data;
    if (kind === "stage_03" || kind === "baseline") {
      const keyMap = new Map<string, string>();
      for (const s of data.sources || []) {
        const saved = upsertSource(runId, {
          url: s.url,
          title: s.title,
          publisher: s.publisher,
          published_at: s.published_at,
          source_type: s.source_type,
          search_excerpt: s.search_excerpt,
        });
        keyMap.set(s.source_key, saved.id);
      }
      for (const c of result.citations) {
        upsertSource(runId, {
          url: c.url,
          title: c.title,
          publisher: "",
          published_at: null,
          source_type: "web_citation",
          search_excerpt: "Responses API citation",
        });
      }
      if (kind === "stage_03") {
        for (const e of data.evidence_drafts || []) {
          e.source_ids = (e.source_keys || []).map((k: string) => keyMap.get(k)).filter(Boolean);
        }
      }
    }
    if (kind === "stage_05") {
      const used = new Set((data.report_claims || []).flatMap((x: any) => x.source_ids || []));
      const refs = listSources(runId).filter((s) => used.has(s.id));
      if (refs.length) {
        data.document_markdown += `\n\n## 主要资料来源\n\n${refs.map((s) => `- [${s.title}](${s.url})`).join("\n")}`;
      }
    }
    return updateArtifact(artifact.id, {
      status: "needs_review",
      json_content: JSON.stringify(data, null, 2),
      markdown_content: data.document_markdown || "",
      model_name: client.model,
      raw_model_output: result.raw,
      response_id: result.responseId,
      token_usage: JSON.stringify(result.usage),
      tool_usage: JSON.stringify(result.toolUsage),
      error_message: null,
    });
  } catch (error) {
    updateArtifact(artifact.id, {
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function editArtifact(id: string, jsonContent: string, markdownContent: string) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error("产物不存在");
  const schema = schemas[artifact.kind as SchemaKind];
  if (schema) schema.parse(JSON.parse(jsonContent));
  const stage = stageNumber(artifact.kind);
  if (stage) supersedeDownstream(artifact.run_id, stage);
  if (artifact.status === "approved" || artifact.status === "superseded") {
    return createArtifact(artifact.run_id, artifact.kind, {
      status: "needs_review",
      json_content: jsonContent,
      markdown_content: markdownContent,
      model_name: artifact.model_name,
      prompt_version: artifact.prompt_version,
      knowledge_version: artifact.knowledge_version,
      input_context: artifact.input_context,
      raw_model_output: artifact.raw_model_output,
      response_id: artifact.response_id,
      token_usage: artifact.token_usage,
      tool_usage: artifact.tool_usage,
    });
  }
  return updateArtifact(id, {
    json_content: jsonContent,
    markdown_content: markdownContent,
    status: "needs_review",
    approved_at: null,
  });
}
