import {
  supersedeWorkItemsForArtifact,
  upsertWorkItem,
} from "../adapters/db";
import type { Artifact } from "./types";

export function syncReviewWorkItems(artifact: Artifact, data: any) {
  const runId = artifact.run_id;
  const kind = artifact.kind;
  supersedeWorkItemsForArtifact(runId, kind, artifact.id, artifact.version);
  const artifactBinding = { artifact_id: artifact.id, attempt: artifact.version };
  if (kind === "stage_03") {
    for (const evidence of data.evidence_drafts || []) {
      const id = String(evidence.id || "");
      if (!id) continue;
      const isGap = evidence.kind === "gap";
      const isConflict = evidence.kind === "conflict";
      upsertWorkItem({
        run_id: runId,
        kind: isGap ? "supplement_evidence" : isConflict ? "resolve_conflict" : "evidence_review",
        stage: "stage_03",
        target_type: "EvidenceDraft",
        target_id: id,
        title: isGap ? `补齐证据缺口：${evidence.statement}` : `审阅证据：${evidence.statement}`,
        priority: isGap || isConflict ? "high" : "medium",
        reason: (evidence.limitations || []).join("；"),
        source_event_id: null,
        ...artifactBinding,
        payload_json: JSON.stringify({
          kind: evidence.kind,
          direction: evidence.direction,
          judgment_unit_ids: evidence.judgment_unit_ids || [],
        }),
      });
    }
  }
  if (kind === "stage_04") {
    for (const judgment of data.judgments || []) {
      const id = String(judgment.id || judgment.judgment_id || "");
      if (!id) continue;
      upsertWorkItem({
        run_id: runId,
        kind: "judgment_review",
        stage: "stage_04",
        target_type: "Judgment",
        target_id: id,
        title: `裁决判断：${judgment.title || judgment.conclusion || judgment.statement}`,
        priority: "high",
        reason: (judgment.uncertainties || []).join("；"),
        source_event_id: null,
        ...artifactBinding,
        payload_json: JSON.stringify({
          strength: judgment.strength || judgment.level,
          invalidation_conditions: judgment.invalidation_conditions || [],
        }),
      });
    }
  }
  if (kind === "independent_review") {
    for (const [index, issue] of (data.issues || []).entries()) {
      const targetId = String(issue.judgment_id || `review-issue-${index + 1}`);
      upsertWorkItem({
        run_id: runId,
        kind: "publish_blocker",
        stage: issue.return_stage || "stage_04",
        target_type: issue.judgment_id ? "Judgment" : "ReviewIssue",
        target_id: targetId,
        title: issue.required_action || issue.description,
        priority: "high",
        reason: issue.description,
        source_event_id: null,
        ...artifactBinding,
        payload_json: JSON.stringify(issue),
      });
    }
  }
}
