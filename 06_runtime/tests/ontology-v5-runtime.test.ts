import { afterEach, describe, expect, it } from "vitest";
import { OntologyActionService } from "@/src/ontology/action-service";
import { ontologyCatalog } from "@/src/ontology/catalog";
import { OntologyFunctionService } from "@/src/ontology/functions";
import { OntologyQueryService } from "@/src/ontology/query-service";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("Ontology 5.0 runtime projection", () => {
  it("loads the semiconductor baseline through ObjectSet queries and canonical link sides", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const actions = new OntologyActionService(store);
    const query = new OntologyQueryService(actions.ontology);
    const context = { actorId: "researcher", actorType: "researcher" as const, accessScopes: ["*"] };

    expect(query.releases()).toEqual(expect.arrayContaining([expect.objectContaining({ domain: "semiconductor", objectCount: expect.any(Number), relationCount: expect.any(Number) })]));
    const variables = query.queryObjects({ typeOrInterface: "ObservableSubject", filters: { category: "demand" }, accessContext: context, limit: 20 });
    expect(variables.some((item) => item.type === "StateVariable")).toBe(true);
    const demand = variables.find((item) => item.id === "end_market_demand_strength")!;
    const traversed = query.traverseLinks({ sourceRefs: [{ id: demand.id, type: demand.type }], linkType: "stateVariableUsesEvidenceProfile", side: "stateVariable", accessContext: context });
    expect(traversed.map((item) => item.object.id)).toContain("demand_orders");
  });

  it("resolves governed Lens requirements and requires handlers for every declared Function", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const functions = new OntologyFunctionService(new OntologyActionService(store).ontology);
    const suggested = functions.execute("SuggestResearchLenses", { goal: "评估公司现金流质量、估值与预期差" });
    const ids = (suggested.suggestions as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["quality", "value_valuation", "expectation_gap"]));
    const requirements = functions.execute("AssembleResearchRequirements", { lensRefs: ["quality", "value_valuation"] });
    expect((requirements.requirements as { evidenceRoles: string[] }).evidenceRoles).toEqual(expect.arrayContaining(["support", "counter"]));
    expect(ontologyCatalog.listFunctionTypes().every((definition) => {
      try { functions.execute(definition.id, {}); return true; }
      catch (error) { return !String(error).includes("No implementation for Ontology function"); }
    })).toBe(true);
  });
});
