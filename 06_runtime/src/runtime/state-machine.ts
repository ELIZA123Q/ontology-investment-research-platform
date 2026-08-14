import { STATE_MACHINE_CATALOG } from "@/src/generated/domain-catalog";

type MachineName = keyof typeof STATE_MACHINE_CATALOG.state_machines;

export class InvalidStateTransitionError extends Error {
  readonly code = "invalid_state_transition";
  readonly status = 409;
  constructor(readonly machine: string, readonly from: string, readonly command: string) {
    super(`Invalid ${machine} transition: ${from} --${command}--> ?`);
  }
}

export interface StateTransition {
  from: string;
  to: string;
  command: string;
  event: string;
}

export function transitionState(machineName: MachineName, current: string, command: string): StateTransition {
  const machine = STATE_MACHINE_CATALOG.state_machines[machineName] as unknown as {
    states: readonly string[];
    transitions?: ReadonlyArray<{ from: string | readonly string[]; command: string; to: string; event: string }>;
  };
  if (!machine.states.includes(current)) throw new InvalidStateTransitionError(String(machineName), current, command);
  const transition = (machine.transitions || []).find((candidate) => {
    const sources = Array.isArray(candidate.from) ? candidate.from : [candidate.from];
    return sources.includes(current) && candidate.command === command;
  });
  if (!transition) throw new InvalidStateTransitionError(String(machineName), current, command);
  return { from: current, to: transition.to, command, event: transition.event };
}

export function isTerminalState(machineName: MachineName, state: string): boolean {
  const machine = STATE_MACHINE_CATALOG.state_machines[machineName] as unknown as { terminal?: readonly string[] };
  return (machine.terminal || []).includes(state);
}

export const TASK_OUTCOME_VALUES = STATE_MACHINE_CATALOG.task_outcomes;
export type GovernedTaskOutcome = typeof TASK_OUTCOME_VALUES[number];

export function taskOutcomeLabel(outcome: string): string {
  const labels = STATE_MACHINE_CATALOG.task_outcome_labels as Record<string, string>;
  return labels[outcome] || outcome;
}

export function approvalCommand(kind: string): { command: string; label: string } | null {
  const mapping = STATE_MACHINE_CATALOG.approval_command_mapping as Record<string, { command: string; label: string }>;
  return mapping[kind] || null;
}
