import { describe, expect, it } from "vitest";
import {
  decideFromRuleDef,
  evalAtom,
  evalCondition,
  formalRuleDef,
  loadFormalOntologyRules,
} from "@/skills/ontology/rule_defs";
import {
  STAGE03_PRECHECK_RULES,
  assertPredicateCatalogCoversRequiredRules,
  buildRulePredicateCatalog,
  predicateKeysForRule,
} from "@/skills/ontology/rule_predicates";

describe("ontology_rule_defs", () => {
  it("loads formal rules from ontology YAML models", () => {
    const rules = loadFormalOntologyRules();
    expect(rules.has("no_direct_evidence_to_judgment")).toBe(true);
    expect(rules.has("judgment_status_consistency")).toBe(true);
    expect(rules.has("semiconductor_proxy_disclosure")).toBe(true);
  });

  it("evaluates atoms, and/or conditions, and counter_conditions", () => {
    expect(evalAtom("flag", { flag: true })).toBe(true);
    expect(evalAtom("missing_x", { x_present: false })).toBe(true);
    expect(evalAtom("target_type_is_Judgment", { target_type: "Judgment" })).toBe(true);
    expect(evalCondition("a and b", { a: true, b: false })).toBe(false);
    expect(evalCondition("a or b", { a: false, b: true })).toBe(true);

    const def = formalRuleDef("valuation_hypothesis_level_coupling")!;
    expect(decideFromRuleDef(def, {
      non_valuation_type_or_level_coupled: true,
      valuation_j3_without_assumption_bridge: false,
      valuation_j4_with_active_competition: false,
    })).toBe("pass");
    expect(decideFromRuleDef(def, {
      non_valuation_type_or_level_coupled: false,
      valuation_j3_without_assumption_bridge: true,
      valuation_j4_with_active_competition: false,
    })).toBe("fail");
  });

  it("judgment_status_consistency uses YAML predicates rather than an empty default branch", () => {
    const def = formalRuleDef("judgment_status_consistency")!;
    expect(def.condition).toContain("unresolved_conflict_implies_contested");
    expect(decideFromRuleDef(def, {
      unresolved_conflict_implies_contested: true,
      decisive_conflict_implies_blocked_or_indeterminate: true,
      blocked_or_indeterminate_has_reason: true,
      supported_with_unresolved_conflict: false,
      blocked_without_reason: false,
      indeterminate_without_reason: false,
    })).toBe("pass");
    expect(decideFromRuleDef(def, {
      unresolved_conflict_implies_contested: false,
      decisive_conflict_implies_blocked_or_indeterminate: true,
      blocked_or_indeterminate_has_reason: true,
      supported_with_unresolved_conflict: true,
      blocked_without_reason: false,
      indeterminate_without_reason: false,
    })).toBe("fail");
  });
});

describe("ontology_rule_predicates catalog", () => {
  it("covers every blocking runtime_semantic_execution rule with YAML-derived keys", () => {
    const check = assertPredicateCatalogCoversRequiredRules();
    expect(check.missing_yaml).toEqual([]);
    expect(check.empty_keys).toEqual([]);
    expect(check.ok).toBe(true);

    const catalog = buildRulePredicateCatalog();
    expect(catalog).toHaveLength(13);
    for (const entry of catalog) {
      expect(entry.runtime_fact_keys.length).toBeGreaterThan(0);
      expect(predicateKeysForRule(entry.rule_id)).toEqual(entry.runtime_fact_keys);
    }
  });

  it("lists Stage03 precheck rule subset", () => {
    expect(STAGE03_PRECHECK_RULES).toContain("semiconductor_proxy_disclosure");
    expect(STAGE03_PRECHECK_RULES).toContain("evidence_scope_time_alignment");
  });
});
