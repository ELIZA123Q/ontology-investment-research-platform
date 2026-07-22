import "server-only";
import { getWorkbenchDb, withImmediateTransaction } from "./db";
import {
  aggregateTaskLocalCandidates,
  extractTaskLocalCandidateOccurrences,
  type OntologyCandidateStatus,
  type TaskLocalCandidateSummary,
} from "../engine/ontology_candidates";

export type OntologyCandidateReview = {
  candidate_key: string;
  status: OntologyCandidateStatus;
  expert_name: string;
  decision_note: string;
  target_ontology_node_id: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OntologyCandidateReviewEvent = {
  id: string;
  candidate_key: string;
  prior_status: OntologyCandidateStatus;
  next_status: OntologyCandidateStatus;
  expert_name: string;
  decision_note: string;
  target_ontology_node_id: string;
  created_at: string;
};

export type GovernedOntologyCandidate = TaskLocalCandidateSummary & {
  review: OntologyCandidateReview;
  review_events: OntologyCandidateReviewEvent[];
};

function pendingReview(candidateKey: string): OntologyCandidateReview {
  return {
    candidate_key: candidateKey,
    status: "pending",
    expert_name: "",
    decision_note: "",
    target_ontology_node_id: "",
    reviewed_at: null,
    created_at: "",
    updated_at: "",
  };
}

function mapReview(row: any): OntologyCandidateReview {
  return {
    candidate_key: String(row.candidate_key),
    status: row.status as OntologyCandidateStatus,
    expert_name: String(row.expert_name || ""),
    decision_note: String(row.decision_note || ""),
    target_ontology_node_id: String(row.target_ontology_node_id || ""),
    reviewed_at: row.reviewed_at ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapEvent(row: any): OntologyCandidateReviewEvent {
  return {
    id: String(row.id),
    candidate_key: String(row.candidate_key),
    prior_status: row.prior_status as OntologyCandidateStatus,
    next_status: row.next_status as OntologyCandidateStatus,
    expert_name: String(row.expert_name),
    decision_note: String(row.decision_note),
    target_ontology_node_id: String(row.target_ontology_node_id || ""),
    created_at: String(row.created_at),
  };
}

export function listOntologyCandidates(): GovernedOntologyCandidate[] {
  const db = getWorkbenchDb();
  const artifactRows = db.prepare(`
    SELECT a.run_id, a.id AS artifact_id, a.version AS artifact_version, a.json_content, a.created_at,
           r.question, r.domain
    FROM artifacts a
    JOIN research_runs r ON r.id=a.run_id
    WHERE a.kind='stage_02'
      AND a.status IN ('approved','needs_review')
      AND a.version=(
        SELECT MAX(a2.version) FROM artifacts a2
        WHERE a2.run_id=a.run_id AND a2.kind='stage_02' AND a2.status IN ('approved','needs_review')
      )
  `).all() as any[];
  const summaries = aggregateTaskLocalCandidates(extractTaskLocalCandidateOccurrences(artifactRows));
  const reviews = new Map(
    (db.prepare("SELECT * FROM ontology_candidate_reviews").all() as any[])
      .map((row) => {
        const review = mapReview(row);
        return [review.candidate_key, review] as const;
      }),
  );
  const events = new Map<string, OntologyCandidateReviewEvent[]>();
  for (const row of db.prepare("SELECT * FROM ontology_candidate_review_events ORDER BY created_at DESC").all() as any[]) {
    const event = mapEvent(row);
    const group = events.get(event.candidate_key) || [];
    group.push(event);
    events.set(event.candidate_key, group);
  }
  return summaries.map((summary) => ({
    ...summary,
    review: reviews.get(summary.candidate_key) || pendingReview(summary.candidate_key),
    review_events: events.get(summary.candidate_key) || [],
  }));
}

export function reviewOntologyCandidate(input: {
  candidateKey: string;
  status: OntologyCandidateStatus;
  expertName: string;
  decisionNote: string;
  targetOntologyNodeId?: string;
}): GovernedOntologyCandidate {
  const allowed: OntologyCandidateStatus[] = ["pending", "expert_confirmed", "promoted", "rejected"];
  if (!allowed.includes(input.status)) throw new Error("本体候选状态无效");
  const candidate = listOntologyCandidates().find((item) => item.candidate_key === input.candidateKey);
  if (!candidate) throw new Error("本体候选不存在或已无当前产物依据");
  const expertName = input.expertName.trim();
  const decisionNote = input.decisionNote.trim();
  const targetOntologyNodeId = String(input.targetOntologyNodeId || "").trim();
  if (input.status !== "pending" && expertName.length < 2) throw new Error("专家确认必须记录审阅人");
  if (input.status !== "pending" && decisionNote.length < 8) throw new Error("专家确认必须记录至少 8 字理由");
  if (input.status === "promoted" && (!targetOntologyNodeId || targetOntologyNodeId.startsWith("task_local:"))) {
    throw new Error("登记晋升必须填写拟正式本体 ID，且不能继续使用 task_local 前缀");
  }
  const db = getWorkbenchDb();
  const now = new Date().toISOString();
  withImmediateTransaction(() => {
    const existing = db.prepare("SELECT * FROM ontology_candidate_reviews WHERE candidate_key=?").get(input.candidateKey) as any;
    const priorStatus = (existing?.status || "pending") as OntologyCandidateStatus;
    if (existing) {
      db.prepare(`UPDATE ontology_candidate_reviews SET
        status=?, expert_name=?, decision_note=?, target_ontology_node_id=?, reviewed_at=?, updated_at=?
        WHERE candidate_key=?`).run(
        input.status, expertName, decisionNote, targetOntologyNodeId,
        input.status === "pending" ? null : now, now, input.candidateKey,
      );
    } else {
      db.prepare(`INSERT INTO ontology_candidate_reviews(
        candidate_key,status,expert_name,decision_note,target_ontology_node_id,reviewed_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        input.candidateKey, input.status, expertName, decisionNote, targetOntologyNodeId,
        input.status === "pending" ? null : now, now, now,
      );
    }
    db.prepare(`INSERT INTO ontology_candidate_review_events(
      id,candidate_key,prior_status,next_status,expert_name,decision_note,target_ontology_node_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.candidateKey, priorStatus, input.status, expertName, decisionNote, targetOntologyNodeId, now,
    );
  });
  return listOntologyCandidates().find((item) => item.candidate_key === input.candidateKey)!;
}
