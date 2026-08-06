import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { projectExpressionAuditYaml } from "@/agents/05_delivery/input_contract";
import { STAGE05_SEMANTIC_REVIEW_CHECKS } from "@/skills/semantic_review/semantic_review";

/** Fields required by 05_governance/03_校验/stages/stage_05/validate_05_outputs.py */
const VALIDATOR_METADATA_KEYS = [
  "task_id",
  "execution_id",
  "delivery_ref",
  "delivery_content_hash",
  "source_04_brief_ref",
  "source_04_audit_ref",
  "source_04_audit_hash",
  "stage_status",
  "quality_status",
  "quality_gate_ref",
  "deterministic_check_status",
  "semantic_review_status",
];

const VALIDATOR_EXPRESSION_FIELDS = [
  "expression_id",
  "source_rcs",
  "location_kind",
  "expression_text",
  "inherited_judgment_level",
  "permitted_role",
  "conditions",
];

const VALIDATOR_EDGE_KEYS = [
  "reference_view_present",
  "differentiated_claim_mapped_to_04",
  "underappreciated_mechanism_supported",
  "falsification_signal_observable",
  "evidence_boundary_disclosed",
  "no_fabricated_consensus",
];

describe("stage05 expression audit ↔ validator alignment", () => {
  it("projectExpressionAuditYaml emits validator-required roots and claim fields", () => {
    const yamlText = projectExpressionAuditYaml(
      {
        document_markdown: "## 一、主判断\n\n结论。\n\n## 市场认知差 / Research Edge\n\n差异化判断。\n",
        research_edge: [{ claim: "库存周期领先市场", why_underappreciated: "街边仍看需求" }],
        report_claims: [
          {
            id: "RC-1",
            statement: "存储周期仍在主动去库存",
            judgment_ids: ["J-1"],
            section: "一、主判断",
          },
        ],
      },
      {
        question: "存储周期？",
        taskId: "JTASK-TEST",
        stage04: {
          brief_ref: "04-判断简报.md",
          audit_ref: "04-推理审计.yaml",
          audit_hash: "sha256:deadbeef",
          execution_id: "EXEC-TEST",
          claims: [{ id: "C-01", judgment_id: "J-1", judgment_level: "J2", statement: "去库存" }],
        },
      },
    );
    const audit = YAML.parse(yamlText);
    expect(audit.document_type).toBe("delivery_expression_audit");
    expect(String(audit.schema_version)).toBe("3.0.0");
    for (const key of VALIDATOR_METADATA_KEYS) {
      expect(audit.metadata).toHaveProperty(key);
    }
    expect(Array.isArray(audit.claim_expression_register)).toBe(true);
    expect(audit.claim_expression_register.length).toBeGreaterThan(0);
    for (const field of VALIDATOR_EXPRESSION_FIELDS) {
      expect(audit.claim_expression_register[0]).toHaveProperty(field);
    }
    for (const key of VALIDATOR_EDGE_KEYS) {
      expect(typeof audit.research_edge_check[key]).toBe("boolean");
    }
    expect(audit).toHaveProperty("report_level_expression_map");
    expect(audit).toHaveProperty("main_judgment_check");
    expect(audit).toHaveProperty("overall_check");
  });

  it("STAGE05 semantic review covers the 10 template check ids", () => {
    expect(STAGE05_SEMANTIC_REVIEW_CHECKS).toHaveLength(10);
    expect(STAGE05_SEMANTIC_REVIEW_CHECKS).toEqual(expect.arrayContaining([
      "main_judgment_is_clear_and_prioritized",
      "research_edge_is_substantive",
      "key_unknowns_are_decision_relevant",
    ]));
  });
});
