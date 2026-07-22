import { describe, expect, it } from "vitest";
import {
  anchorLabels,
  buildJudgmentUnitConcepts,
  buildStructureDisplayLookups,
  judgmentTypeLabel,
  ontologyTypeLabel,
  resolveOntologyDisplayLabel,
  scopeDimensionKeyLabel,
  variableCategoryLabel,
  variableKindLabel,
  variableRoleLabel,
} from "../engine/ontology_display_labels";

describe("ontology_display_labels", () => {
  it("合同枚举值映射为研究员中文", () => {
    expect(judgmentTypeLabel("transmission_path")).toBe("传导路径");
    expect(variableKindLabel("qualitative_or_derived")).toBe("定性或派生型");
    expect(variableRoleLabel("primary_judgment_variable")).toBe("主判断变量");
    expect(variableCategoryLabel("economics")).toBe("经济");
    expect(scopeDimensionKeyLabel("geography")).toBe("地区");
  });

  it("从本体 YAML 解析对象类型与锚点中文", () => {
    expect(ontologyTypeLabel("Product")).toBe("产品");
    expect(ontologyTypeLabel("ManufacturingFacility")).toMatch(/制造|设施/);
    expect(anchorLabels(["Product", "Company"])).toEqual(["产品", "公司"]);
  });

  it("结构展示 lookup 解析 task_local 与判断单元标题", () => {
    const display = buildStructureDisplayLookups({
      variables: [{ id: "VAR-1", name: "存储芯片折旧强度", ontology_node_id: "task_local:VAR-1" }],
      units: [{ id: "JU-1", title: "折旧是否抬升" }],
      research_scope: { id: "SCOPE-1", label: "存储周期·全球" },
    });
    expect(resolveOntologyDisplayLabel("task_local:VAR-1", display.ontologyNames)).toBe("存储芯片折旧强度");
    expect(display.unitTitles.get("JU-1")).toBe("折旧是否抬升");
    expect(display.scopeLabels.get("SCOPE-1")).toBe("存储周期·全球");
  });

  it("正式 StateVariable id 可解析为领域中文名", () => {
    const display = buildStructureDisplayLookups({ variables: [], units: [] });
    const label = resolveOntologyDisplayLabel("product_price_pressure", display.ontologyNames);
    expect(label).toBe("产品价格压力");
  });

  it("判断单元关键概念去重并标注来源", () => {
    const lines = buildJudgmentUnitConcepts(
      { ontology_node_ids: ["product_price_pressure", "task_local:VAR-1"] },
      ["SV-1"],
      [
        { id: "VAR-1", name: "本轮折旧", ontology_node_id: "task_local:VAR-1" },
        { id: "SV-1", name: "产品价格压力", ontology_node_id: "product_price_pressure" },
      ],
    );
    expect(lines).toEqual([
      "产品价格压力 · 正式本体",
      "本轮折旧 · 本轮新建（待入库）",
    ]);
  });
});
