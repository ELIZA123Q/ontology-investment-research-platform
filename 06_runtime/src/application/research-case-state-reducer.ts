import type { ResearchCaseCommandType, ResearchCaseV2 } from "@/src/application/research-case-contracts";
import { transitionState, type StateTransition } from "@/src/runtime/state-machine";

export function reduceResearchCaseState(current: ResearchCaseV2, command: ResearchCaseCommandType): StateTransition {
  return transitionState("ResearchCase", current.status, command);
}
