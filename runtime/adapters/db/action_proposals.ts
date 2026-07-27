import "server-only";
import type { StoredActionProposal, StoredActionExecution } from "../../engine/types";
import { db } from "./connection";
function mapActionProposal(row: any): StoredActionProposal {
  return {
    ...row,
    expected_graph_version: Number(row.expected_graph_version),
  } as StoredActionProposal;
}

export function createActionProposalRecord(input: Omit<StoredActionProposal, "status" | "created_at" | "approved_at" | "executed_at" | "execution_id">): StoredActionProposal {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO action_proposals(
    id,run_id,action_id,parameters_json,expected_graph_version,proposal_json,status,work_item_id,
    created_at,approved_at,executed_at,execution_id
  ) VALUES(?,?,?,?,?,?,'pending',?,?,NULL,NULL,NULL)`).run(
    input.id,
    input.run_id,
    input.action_id,
    input.parameters_json,
    input.expected_graph_version,
    input.proposal_json,
    input.work_item_id,
    now,
  );
  return getActionProposal(input.id)!;
}

export function getActionProposal(id: string): StoredActionProposal | undefined {
  const row = db.prepare("SELECT * FROM action_proposals WHERE id=?").get(id) as any;
  return row ? mapActionProposal(row) : undefined;
}

export function listActionProposals(runId: string): StoredActionProposal[] {
  return (db.prepare("SELECT * FROM action_proposals WHERE run_id=? ORDER BY created_at DESC").all(runId) as any[]).map(mapActionProposal);
}

export function markActionProposalExecuted(proposalId: string, executionId: string) {
  const now = new Date().toISOString();
  db.prepare("UPDATE action_proposals SET status='executed',executed_at=?,execution_id=? WHERE id=?")
    .run(now, executionId, proposalId);
  return getActionProposal(proposalId)!;
}

export function getActionExecution(proposalId: string): StoredActionExecution | undefined {
  return db.prepare("SELECT * FROM action_executions WHERE proposal_id=?").get(proposalId) as StoredActionExecution | undefined;
}

export function createActionExecutionRecord(input: StoredActionExecution): StoredActionExecution {
  db.prepare(`INSERT INTO action_executions(
    execution_id,proposal_id,run_id,action_id,graph_version_before,graph_version_after,status,result_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    input.execution_id,
    input.proposal_id,
    input.run_id,
    input.action_id,
    input.graph_version_before,
    input.graph_version_after,
    input.status,
    input.result_json,
    input.created_at,
  );
  return getActionExecution(input.proposal_id)!;
}
