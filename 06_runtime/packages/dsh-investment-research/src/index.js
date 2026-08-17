import { defineTool } from "@deepseek-ai/dsh-tools";
import { InvestmentDomainGateway } from "./domain-gateway.js";

export const name = "investment-research";
export const inject = ["tools"];

const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
};

const string = (description, required = false) => ({ type: "string", description, ...(required ? { required: true } : {}) });

/**
 * DSH owns the model loop and session log. This plugin only turns safe model
 * requests into calls to the existing governed domain service.
 */
export function apply(ctx, config = {}) {
  const gateway = new InvestmentDomainGateway(config);
  ctx.tools.register(defineTool({
    name: "investment_list_research_cases",
    description: "List governed A-share earnings-update research cases.",
    parameters: {}, output: objectOutput,
    execute: async () => gateway.listResearchCases(),
  }));
  ctx.tools.register(defineTool({
    name: "investment_create_research_case",
    description: "Create a draft A-share semiconductor earnings-update research case. This does not approve a plan or publish a conclusion.",
    parameters: {
      companyCode: string("Six-digit A-share code, optionally prefixed SH or SZ", true),
      companyName: string("Company name", true),
      asOf: string("Research cutoff ISO date", true),
      researchQuestion: string("Investment thesis review question", true),
      primaryLens: string("Primary research lens", true),
      counterLens: string("Counter research lens", true),
    }, output: objectOutput,
    execute: async (args) => gateway.createResearchCase({ ...args, reportSpec: {}, sourcePolicy: {} }),
  }));
  ctx.tools.register(defineTool({
    name: "investment_get_research_case",
    description: "Read a governed research-case snapshot, its locked knowledge bundle, artifacts, and pending human intervention.",
    parameters: { researchCaseId: string("Research case id", true) }, output: objectOutput,
    execute: async (args) => gateway.getResearchCase(args.researchCaseId),
  }));
  ctx.tools.register(defineTool({
    name: "investment_query_evidence",
    description: "Query and capture a governed public source for an existing research case. The domain service records provenance and applies source policy.",
    parameters: {
      researchCaseId: string("Research case id", true),
      query: string("Evidence query", true),
      reportPeriod: string("Optional report period"),
    }, output: objectOutput,
    execute: async (args) => gateway.querySource(args),
  }));
}
