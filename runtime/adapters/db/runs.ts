import "server-only";
import { cache } from "react";
import { createHash } from "node:crypto";
import type { ResearchRun, ResearchExperienceEvent, ResearchExperienceEventType, ImpactClassification } from "../../engine/types";
import { db, withImmediateTransaction } from "./connection";
import { createChildManifest, createEmptyManifest, parseManifest, recordApprovedStage } from "../../engine/manifest";
import { latestArtifact, createArtifact } from "./artifacts";
import { listSources, upsertSource } from "./sources";
import { extractGraph } from "../../engine/instance_graph";
import { evidenceBoundSourceIds } from "../../engine/evidence_sources";
import { saveInstanceGraph } from "./meta";
function mapRun(row: any): ResearchRun {
  return {
    id: row.id,
    question: row.question,
    domain: row.domain,
    current_stage: row.current_stage,
    status: row.status,
    package_path: row.package_path ?? null,
    parent_run_id: row.parent_run_id ?? null,
    trigger_event_id: row.trigger_event_id ?? null,
    trigger_classification: row.trigger_classification ?? null,
    manifest_json: row.manifest_json || "{}",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listRuns(): ResearchRun[] {
  return (db.prepare("SELECT * FROM research_runs ORDER BY created_at DESC").all() as any[]).map(mapRun);
}
export const getRun = cache(function getRun(id: string): ResearchRun | undefined {
  const row = db.prepare("SELECT * FROM research_runs WHERE id=?").get(id) as any;
  return row ? mapRun(row) : undefined;
});
export function previousComparableRun(runId: string): ResearchRun | undefined {
  const current = getRun(runId);
  if (!current) return undefined;
  const row = db.prepare(
    `SELECT * FROM research_runs
     WHERE id != ? AND domain = ? AND trim(question) = ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(current.id, current.domain, current.question.trim(), current.created_at) as any;
  return row ? mapRun(row) : undefined;
}
export function createRun(
  question: string,
  domain: string,
  packagePath?: string | null,
  options: {
    parentRunId?: string | null;
    triggerEventId?: string | null;
    triggerClassification?: ImpactClassification | null;
    experienceCase?: {
      cohortId: string;
      caseId: string;
      informationCutoff: string;
    } | null;
  } = {},
): ResearchRun {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const draft = mapRun({
    id,
    question,
    domain,
    current_stage: 0,
    status: "draft",
    package_path: packagePath || null,
    parent_run_id: options.parentRunId || null,
    trigger_event_id: options.triggerEventId || null,
    trigger_classification: options.triggerClassification || null,
    manifest_json: "{}",
    created_at: now,
    updated_at: now,
  });
  const parent = options.parentRunId ? getRun(options.parentRunId) : undefined;
  const manifest = parent
    ? createChildManifest(draft, parent, `sha256:${createHash("sha256").update(parent.manifest_json).digest("hex")}`)
    : createEmptyManifest(draft);
  db.prepare(
    "INSERT INTO research_runs(id,question,domain,current_stage,status,package_path,manifest_json,created_at,updated_at,parent_run_id,trigger_event_id,trigger_classification) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    question,
    domain,
    0,
    "draft",
    packagePath || null,
    JSON.stringify(manifest),
    now,
    now,
    options.parentRunId || null,
    options.triggerEventId || null,
    options.triggerClassification || null,
  );
  recordResearchExperienceEvent({
    runId: id,
    eventType: "run_created",
    actorType: options.parentRunId ? "system" : "human",
    targetType: "ResearchRun",
    targetId: id,
    outcome: options.parentRunId ? "incremental_run_created" : "new_research_created",
    payload: options.experienceCase ? {
      experience_cohort_id: options.experienceCase.cohortId,
      experience_case_id: options.experienceCase.caseId,
      information_cutoff: options.experienceCase.informationCutoff,
    } : undefined,
    dedupeKey: `run_created:${id}`,
    occurredAt: now,
  });
  return getRun(id)!;
}

export function recordResearchExperienceEvent(input: {
  runId: string;
  eventType: ResearchExperienceEventType;
  actorType: ResearchExperienceEvent["actor_type"];
  stage?: string;
  targetType?: string;
  targetId?: string;
  outcome?: string;
  payload?: Record<string, unknown>;
  dedupeKey: string;
  occurredAt?: string;
}): ResearchExperienceEvent {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const existing = db.prepare("SELECT * FROM research_experience_events WHERE dedupe_key=?")
    .get(input.dedupeKey) as ResearchExperienceEvent | undefined;
  if (existing) return existing;
  const event: ResearchExperienceEvent = {
    id: crypto.randomUUID(),
    run_id: input.runId,
    event_type: input.eventType,
    actor_type: input.actorType,
    stage: input.stage || "",
    target_type: input.targetType || "",
    target_id: input.targetId || "",
    outcome: input.outcome || "",
    payload_json: JSON.stringify(input.payload || {}),
    dedupe_key: input.dedupeKey,
    occurred_at: occurredAt,
  };
  db.prepare(`INSERT INTO research_experience_events(
    id,run_id,event_type,actor_type,stage,target_type,target_id,outcome,payload_json,dedupe_key,occurred_at
  ) VALUES(${Array(11).fill("?").join(",")})`).run(...Object.values(event));
  return event;
}

export function listResearchExperienceEvents(runId: string): ResearchExperienceEvent[] {
  return db.prepare("SELECT * FROM research_experience_events WHERE run_id=? ORDER BY occurred_at ASC, id ASC")
    .all(runId) as ResearchExperienceEvent[];
}
export function updateRun(id: string, fields: Partial<Pick<ResearchRun, "package_path" | "manifest_json" | "status" | "current_stage" | "parent_run_id" | "trigger_event_id" | "trigger_classification">>): ResearchRun {
  const entries = Object.entries({ ...fields, updated_at: new Date().toISOString() }).filter(([, value]) => value !== undefined);
  if (entries.length) {
    db.prepare(`UPDATE research_runs SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`).run(
      ...entries.map(([, value]) => value as string | number | null),
      id,
    );
  }
  return getRun(id)!;
}

/** Collect run id and all descendant incremental runs (children first, root last). */
export function collectRunSubtreeIds(rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const run of listRuns()) {
    if (!run.parent_run_id) continue;
    const siblings = childrenByParent.get(run.parent_run_id) || [];
    siblings.push(run.id);
    childrenByParent.set(run.parent_run_id, siblings);
  }
  const ordered: string[] = [];
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) || []) visit(childId);
    ordered.push(id);
  };
  visit(rootId);
  return ordered;
}

function deleteRunRecords(runId: string): void {
  // action_executions.proposal_id and action_proposals.work_item_id use RESTRICT —
  // clear them before cascading work items / proposals / the run itself.
  db.prepare("DELETE FROM action_executions WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM action_proposals WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM research_work_items WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM event_impacts WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM artifacts WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM source WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM research_runs WHERE id=?").run(runId);
}

/** Hard-delete a research run and all of its incremental descendant runs. */
export function deleteRun(id: string): { deleted_ids: string[] } {
  const run = getRun(id);
  if (!run) throw new Error("任务不存在");
  const deletedIds = collectRunSubtreeIds(id);
  withImmediateTransaction(() => {
    for (const runId of deletedIds) deleteRunRecords(runId);
  });
  return { deleted_ids: deletedIds };
}

export function createChildRun(
  parentRunId: string,
  triggerEventId: string,
  classification: ImpactClassification = "evidence_update",
): ResearchRun {
  const parent = getRun(parentRunId);
  if (!parent) throw new Error("父运行不存在");
  const child = createRun(parent.question, parent.domain, parent.package_path, {
    parentRunId,
    triggerEventId,
    triggerClassification: classification,
  });
  let manifest = parseManifest(child.manifest_json, child);
  const inheritedStages = classification === "evidence_update"
    ? (["stage_01", "stage_02"] as const)
    : classification === "structure_revision"
      ? (["stage_01"] as const)
      : ([] as const);
  const inheritedSourceIdMap = new Map<string, string>();
  for (const kind of inheritedStages) {
    const inherited = latestArtifact(parent.id, kind, ["approved"]);
    if (!inherited) continue;
    const copy = createArtifact(child.id, kind, {
      status: "approved",
      json_content: inherited.json_content,
      markdown_content: inherited.markdown_content,
      model_name: inherited.model_name,
      prompt_version: inherited.prompt_version,
      knowledge_version: inherited.knowledge_version,
      input_context: inherited.input_context,
      raw_model_output: inherited.raw_model_output,
      response_id: inherited.response_id,
      token_usage: inherited.token_usage,
      tool_usage: inherited.tool_usage,
      approved_at: new Date().toISOString(),
    });
    manifest = recordApprovedStage(manifest, copy);
  }
  const parentGraph = classification === "evidence_update"
    ? latestArtifact(parent.id, "instance_graph", ["approved"])
    : undefined;
  if (classification === "evidence_update") {
    const parentEvidence = latestArtifact(parent.id, "stage_03", ["approved"]);
    const evidenceIds = evidenceBoundSourceIds(parentEvidence ? JSON.parse(parentEvidence.json_content) : {});
    const graphIds = new Set(
      (parentGraph ? extractGraph(JSON.parse(parentGraph.json_content))?.objects || [] : [])
        .filter((object) => object.type === "SourceDocument")
        .map((object) => object.id),
    );
    const inheritableIds = new Set([...evidenceIds, ...graphIds]);
    for (const source of listSources(parent.id).filter((item) => inheritableIds.has(item.id))) {
      const inheritedSource = upsertSource(child.id, {
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        published_at: source.published_at,
        source_type: `inherited:${source.source_type}`,
        source_tier: source.source_tier,
        authority_type: source.authority_type || "unknown",
        source_group: source.source_group,
        search_excerpt: source.search_excerpt,
        locator: source.locator,
        captured_at: source.captured_at,
        content_hash: source.content_hash,
        usability_status: source.usability_status,
        failure_category: source.failure_category,
        failure_detail: source.failure_detail,
        final_url: source.final_url,
        content_mime: source.content_mime,
        http_status: source.http_status,
        retrieval_status: source.retrieval_status,
        snapshot_text: source.snapshot_text,
        source_quote: source.source_quote,
        quote_verified: source.quote_verified,
      });
      inheritedSourceIdMap.set(source.id, inheritedSource.id);
    }
  }
  if (parentGraph) {
    const inheritedPayload = remapStableReferences(JSON.parse(parentGraph.json_content), inheritedSourceIdMap);
    saveInstanceGraph(
      child.id,
      inheritedPayload,
      `inherited snapshot from ${parent.id}; source registry IDs remapped to this run; unaffected objects remain current until replaced by an approved ChangeSet`,
    );
  }
  updateRun(child.id, {
    current_stage: latestArtifact(child.id, "stage_02", ["approved"]) ? 2 : latestArtifact(child.id, "stage_01", ["approved"]) ? 1 : 0,
    status: "in_progress",
    manifest_json: JSON.stringify(manifest),
  });
  return getRun(child.id)!;
}

/**
 * Source rows are run-scoped, while graph references must point at rows in the
 * current run.  A child therefore cannot copy the parent's graph byte-for-byte.
 * Remap exact stable references everywhere in the payload so relation endpoints,
 * projections and any source_id/source_ids properties remain coherent.
 */
function remapStableReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (!idMap.size) return value;
  if (typeof value === "string") return idMap.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => remapStableReferences(item, idMap));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, remapStableReferences(item, idMap)]),
    );
  }
  return value;
}
