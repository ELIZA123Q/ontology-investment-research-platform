import { describe, expect, it } from "vitest";
import { deriveOntologyResearchValue } from "@/engine/ontology_research_value";

describe("ontology research value", () => {
  it("explains formal completion, task-local constraint, rule boundary and graph connection", () => {
    const summary = deriveOntologyResearchValue({
      structure: {
        variables: [
          { id: "VAR-PRICE", name: "产品价格压力", ontology_node_id: "product_price_pressure" },
          { id: "VAR-LOCAL", name: "本轮特殊折旧口径", ontology_node_id: "task_local:VAR-LOCAL" },
        ],
        judgment_units: [{
          id: "JU-1",
          title: "价格压力是否缓解",
          ontology_node_ids: ["product_price_pressure"],
        }],
      },
      judgment: {
        rule_evaluations: [{
          id: "RE-1",
          rule_ref: "judgment_evidence_threshold",
          result: "fail",
          deterministic_result: {
            result: "fail",
            rationale: "当前证据上限为 J1，不能形成 J2",
          },
        }],
      },
      graph: {
        schema_name: "ontology_business_instance_graph",
        schema_version: "1.0.0",
        authority: "business_parameters",
        objects: [
          { id: "EV-1", type: "EvidenceFact", properties: { statement: "价格跌幅收窄" } },
          { id: "JU-1", type: "JudgmentUnit", properties: { title: "价格压力是否缓解" } },
        ],
        relations: [{
          id: "REL-1",
          type: "factSupportsJudgmentUnit",
          sourceId: "EV-1",
          targetId: "JU-1",
        }],
      },
      labelForOntologyRef: (ref) => ({
        product_price_pressure: "产品价格压力",
        judgment_evidence_threshold: "判断证据门槛",
        factSupportsJudgmentUnit: "事实支持判断单元",
      }[ref] || ref),
    });

    expect(summary.counts).toEqual({ completion: 1, constraint: 2, connection: 2 });
    expect(summary.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "completion", title: "对齐“产品价格压力”的正式口径" }),
      expect.objectContaining({ kind: "constraint", title: "保留“本轮特殊折旧口径”为本轮候选" }),
      expect.objectContaining({ kind: "constraint", title: "判断证据门槛：未通过", explanation: "当前证据上限为 J1，不能形成 J2" }),
      expect.objectContaining({ kind: "connection", result: "关联：支持影响查询与局部重算" }),
    ]));
    expect(summary.relevant_node_ids).toEqual(expect.arrayContaining([
      "product_price_pressure",
      "judgment_evidence_threshold",
      "EvidenceFact",
      "factSupportsJudgmentUnit",
      "JudgmentUnit",
    ]));
    expect(summary.relevant_node_ids).not.toContain("task_local:VAR-LOCAL");
  });
});
