import type { ReportSpecInput } from "@/src/contracts";
import { STATE_MACHINE_CATALOG } from "@/src/generated/domain-catalog";

/** Stable HTTP/application contract; domain execution details stay behind the service. */
export interface CreateResearchCaseInput {
  companyCode: string;
  companyName: string;
  asOf: string;
  researchQuestion: string;
  primaryLens: string;
  counterLens: string;
  reportSpec: ReportSpecInput;
  sourcePolicy: Record<string, unknown>;
}

export type ResearchCaseCommandType = typeof STATE_MACHINE_CATALOG.command_contract.commands[number];

export interface ResearchCaseCommand {
  type: ResearchCaseCommandType;
  expectedVersion: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface ResearchCaseV2 {
  id: string;
  conversationId: string;
  taskId: string;
  ownerId: string;
  version: number;
  companyCode: string;
  companyName: string;
  asOf: string;
  researchQuestion: string;
  primaryLens: string;
  counterLens: string;
  reportSpec: ReportSpecInput;
  sourcePolicy: Record<string, unknown>;
  status: typeof STATE_MACHINE_CATALOG.state_machines.ResearchCase.states[number];
  createdAt: string;
  updatedAt: string;
}

export class CaseVersionConflictError extends Error {
  readonly status = 409;
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`ResearchCase version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
  }
}

export class CaseCommandConflictError extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); }
}

export function validateCommand(command: ResearchCaseCommand): void {
  if (!STATE_MACHINE_CATALOG.command_contract.commands.includes(command.type)) throw new Error(`Unsupported command: ${command.type}`);
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) throw new Error("expectedVersion must be a positive integer");
  if (!command.idempotencyKey?.trim()) throw new Error("idempotencyKey is required");
  if (!command.payload || typeof command.payload !== "object" || Array.isArray(command.payload)) throw new Error("payload must be an object");
}

export function validateCreateInput(input: CreateResearchCaseInput): CreateResearchCaseInput {
  const companyCode = String(input.companyCode || "").trim().toUpperCase();
  const companyName = String(input.companyName || "").trim();
  const researchQuestion = String(input.researchQuestion || "").trim();
  const primaryLens = String(input.primaryLens || "").trim();
  const counterLens = String(input.counterLens || "").trim();
  const asOf = new Date(input.asOf);
  if (!/^(?:SH|SZ)?\d{6}$/.test(companyCode)) throw new Error("companyCode must be a six-digit A-share code with optional SH/SZ prefix");
  if (!companyName || !researchQuestion || !primaryLens || !counterLens) throw new Error("companyName, researchQuestion, primaryLens and counterLens are required");
  if (Number.isNaN(asOf.getTime())) throw new Error("asOf must be a valid ISO date");
  return { ...input, companyCode, companyName, researchQuestion, primaryLens, counterLens, asOf: asOf.toISOString(), reportSpec: input.reportSpec || {}, sourcePolicy: input.sourcePolicy || {} };
}
