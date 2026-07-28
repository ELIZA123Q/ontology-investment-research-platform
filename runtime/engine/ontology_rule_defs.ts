/**
 * P1：从本体 models/*.yaml 加载正式规则定义，并用 condition/counter_conditions 做谓词判定。
 * Runtime 分支只负责算出谓词事实；通过/失败由 YAML 条件驱动，避免双源漂移。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";

export type FormalRuleDef = {
  id: string;
  condition: string;
  counter_conditions: string[];
  preconditions: string[];
  test_case_role?: string;
};

const MODEL_FILES = [
  "semantic.yaml",
  "state_event.yaml",
  "evidence.yaml",
  "judgment.yaml",
  "scenario.yaml",
  "semiconductor_extension.yaml",
] as const;

let cachedRules: Map<string, FormalRuleDef> | null = null;

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value == null) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text !== "" && text !== "false" && text !== "0" && text !== "no" && text !== "null" && text !== "none";
  }
  if (Array.isArray(value) || (typeof value === "object")) return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function derivedPredicate(name: string, facts: Record<string, unknown>): boolean | null {
  if (name === "target_type_is_Judgment") return facts.target_type === "Judgment";
  if (name.endsWith("_present")) return truthy(facts[name]);
  if (name.startsWith("missing_")) {
    const stem = name.slice("missing_".length);
    const presentKey = `${stem}_present`;
    if (presentKey in facts) return !truthy(facts[presentKey]);
    if (stem in facts) return !truthy(facts[stem]);
  }
  return null;
}

export function evalAtom(atom: string, facts: Record<string, unknown>): boolean {
  const text = atom.trim();
  if (!text) return true;
  const inMatch = /^([A-Za-z_][\w.]*)\s+in\s+\[([^\]]+)\]$/.exec(text);
  if (inMatch) {
    const allowed = inMatch[2].split(",").map((part) => part.trim()).filter(Boolean);
    return allowed.includes(String(facts[inMatch[1]] ?? ""));
  }
  if (text in facts) return truthy(facts[text]);
  const derived = derivedPredicate(text, facts);
  if (derived != null) return derived;
  return false;
}

export function evalCondition(expression: string, facts: Record<string, unknown>): boolean {
  const expr = String(expression || "").trim();
  if (!expr) return true;
  return expr.split(/\s+or\s+/).some((clause) =>
    clause.split(/\s+and\s+/).every((atom) => evalAtom(atom, facts)));
}

export function decideFromRuleDef(
  rule: FormalRuleDef,
  facts: Record<string, unknown>,
): "pass" | "fail" {
  for (const counter of rule.counter_conditions) {
    if (evalAtom(counter, facts)) return "fail";
  }
  return evalCondition(rule.condition, facts) ? "pass" : "fail";
}

export function loadFormalOntologyRules(): Map<string, FormalRuleDef> {
  if (cachedRules) return cachedRules;
  const rules = new Map<string, FormalRuleDef>();
  const modelDir = repositoryPath("ontology", "01_通用", "models");
  for (const file of MODEL_FILES) {
    const raw = YAML.parse(readFileSync(path.join(modelDir, file), "utf8")) as Record<string, any>;
    for (const section of ["rules", "evidence_constraints"] as const) {
      const block = raw?.[section] || {};
      for (const [id, value] of Object.entries(block)) {
        if (!value || typeof value !== "object") continue;
        const item = value as Record<string, unknown>;
        rules.set(id, {
          id,
          condition: String(item.condition || ""),
          counter_conditions: Array.isArray(item.counter_conditions)
            ? item.counter_conditions.map(String)
            : [],
          preconditions: Array.isArray(item.preconditions)
            ? item.preconditions.map(String)
            : [],
          test_case_role: item.test_case_role ? String(item.test_case_role) : undefined,
        });
      }
    }
  }
  cachedRules = rules;
  return rules;
}

export function formalRuleDef(ruleId: string): FormalRuleDef | undefined {
  return loadFormalOntologyRules().get(ruleId);
}
