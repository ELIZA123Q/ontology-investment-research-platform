import type { ReportSpecInput } from "@/src/contracts";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { buildResearchCaseSnapshot } from "@/src/application/research-case-projection";
import { ResearchCaseCommandHandler } from "@/src/application/research-case-command-handler";
import { type CreateResearchCaseInput, type ResearchCaseCommand, type ResearchCaseV2, validateCreateInput } from "@/src/application/research-case-contracts";
export { CaseCommandConflictError, CaseVersionConflictError } from "@/src/application/research-case-contracts";
export type { CreateResearchCaseInput, ResearchCaseCommand, ResearchCaseCommandType, ResearchCaseV2 } from "@/src/application/research-case-contracts";

const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const now = () => new Date().toISOString();

/** Application use case facade for the ResearchCase aggregate. */
export class ResearchCaseService {
  readonly kernel: AgentKernel;
  private readonly commands: ResearchCaseCommandHandler;

  constructor(readonly store: RuntimeStore) {
    this.kernel = new AgentKernel(store);
    this.commands = new ResearchCaseCommandHandler(store, this.kernel, (id) => this.requireCase(id));
  }

  create(input: CreateResearchCaseInput): ResearchCaseV2 {
    const normalized = validateCreateInput(input);
    return this.store.transaction(() => {
      const conversation = this.store.createConversation(`${normalized.companyName}（${normalized.companyCode}）业绩更新与命题复核`);
      const goal = `截至 ${normalized.asOf}，对 ${normalized.companyName}（${normalized.companyCode}）开展业绩更新与投资命题复核。研究问题：${normalized.researchQuestion}。主 Lens：${normalized.primaryLens}；反 Lens：${normalized.counterLens}。`;
      const submitted = this.kernel.submitGoal(conversation.id, goal, undefined, {
        reportSpec: { ...normalized.reportSpec, kind: "judgment_update" },
        lensRefs: [normalized.primaryLens, normalized.counterLens],
      });
      const stamp = now();
      this.store.db.prepare(`INSERT INTO research_cases
        (id,conversation_id,task_id,owner_id,version,company_code,company_name,as_of,research_question,primary_lens,counter_lens,report_spec_json,source_policy_json,status,created_at,updated_at)
        VALUES (?, ?, ?, 'researcher', 1, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
        .run(submitted.task.researchCaseId, conversation.id, submitted.task.id, normalized.companyCode, normalized.companyName,
          normalized.asOf, normalized.researchQuestion, normalized.primaryLens, normalized.counterLens,
          json(normalized.reportSpec), json(normalized.sourcePolicy), stamp, stamp);
      this.store.appendEvent({ conversationId: conversation.id, taskId: submitted.task.id, type: "research_case.created", actorType: "researcher", actorId: "researcher", payload: { researchCaseId: submitted.task.researchCaseId, companyCode: normalized.companyCode, companyName: normalized.companyName, asOf: normalized.asOf } });
      return this.requireCase(submitted.task.researchCaseId);
    });
  }

  get(id: string): ResearchCaseV2 | null {
    const row = this.store.db.prepare("SELECT * FROM research_cases WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCase(row) : null;
  }

  list(): ResearchCaseV2[] {
    return (this.store.db.prepare("SELECT * FROM research_cases ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(this.mapCase);
  }

  snapshot(id: string) {
    const researchCase = this.requireCase(id);
    return buildResearchCaseSnapshot(researchCase, this.kernel);
  }

  execute(id: string, command: ResearchCaseCommand): { researchCase: ResearchCaseV2; result: unknown } {
    return this.commands.execute(id, command);
  }

  private requireCase(id: string): ResearchCaseV2 {
    const researchCase = this.get(id);
    if (!researchCase) throw new Error(`ResearchCase not found: ${id}`);
    return researchCase;
  }

  private mapCase = (row: Record<string, unknown>): ResearchCaseV2 => ({
    id: String(row.id), conversationId: String(row.conversation_id), taskId: String(row.task_id), ownerId: String(row.owner_id), version: Number(row.version),
    companyCode: String(row.company_code), companyName: String(row.company_name), asOf: String(row.as_of), researchQuestion: String(row.research_question),
    primaryLens: String(row.primary_lens), counterLens: String(row.counter_lens),
    reportSpec: parse<ReportSpecInput>(row.report_spec_json, {}), sourcePolicy: parse<Record<string, unknown>>(row.source_policy_json, {}),
    status: row.status as ResearchCaseV2["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
}
