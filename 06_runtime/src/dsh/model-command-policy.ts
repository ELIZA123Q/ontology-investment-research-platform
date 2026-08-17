/** Commands below establish formal research state and must originate from a researcher UI, never a model tool. */
export const FORBIDDEN_MODEL_RESEARCH_CASE_COMMANDS = new Set([
  "confirm_plan",
  "confirm_evidence",
  "approve_judgment",
  "publish",
  "revise_judgment",
  "revise_report",
]);

export function assertModelResearchCaseCommandAllowed(command: string): void {
  if (FORBIDDEN_MODEL_RESEARCH_CASE_COMMANDS.has(command)) {
    throw new Error(`Researcher confirmation is required for ${command}; DSH models cannot issue this command`);
  }
}
