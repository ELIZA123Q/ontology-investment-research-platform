import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { schemas, type SchemaKind } from "../engine/schemas";
import { ontologyToolDefinitions, runOntologyTool, type OntologyToolName } from "../engine/ontology_tools";

type Citation = { url: string; title: string };
export type ModelResult<T> = {
  data: T;
  raw: string;
  responseId: string;
  usage: unknown;
  toolUsage: unknown;
  citations: Citation[];
};

export class ResearchModelClient {
  private client: OpenAI;
  readonly model = process.env.OPENAI_MODEL || "gpt-5.4";
  readonly reasoning = (process.env.OPENAI_REASONING_EFFORT || "medium") as "low" | "medium" | "high";
  constructor() {
    if (!process.env.OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY，请复制 .env.example 为 .env.local 后填写");
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generate(
    kind: SchemaKind,
    instructions: string,
    input: string,
    options: { webSearch?: boolean; ontologyTools?: boolean; runId?: string } = {},
  ): Promise<ModelResult<any>> {
    const schema = schemas[kind];
    const tools: any[] = [];
    if (options.webSearch) tools.push({ type: "web_search" as const });
    if (options.ontologyTools) tools.push(...ontologyToolDefinitions);

    let firstRaw = "";
    try {
      if (options.ontologyTools && options.runId && tools.length) {
        return await this.generateWithOntologyTools(kind, instructions, input, tools, options.runId, options.webSearch || false);
      }
      const response = await this.client.responses.parse({
        model: this.model,
        instructions,
        input,
        reasoning: { effort: this.reasoning },
        tools: tools.length ? tools : undefined,
        text: { format: zodTextFormat(schema, kind) },
      });
      firstRaw = response.output_text;
      if (!response.output_parsed) throw new Error("模型未返回结构化结果");
      return this.result(response, response.output_parsed);
    } catch (error) {
      if (!firstRaw) throw error;
      const repair = await this.client.responses.parse({
        model: this.model,
        instructions: "修复下面的输出，使其严格符合要求的 JSON schema。不要改变已有事实或添加新来源。",
        input: firstRaw,
        text: { format: zodTextFormat(schema, kind) },
      });
      if (!repair.output_parsed) throw error;
      return this.result(repair, repair.output_parsed, firstRaw);
    }
  }

  private async generateWithOntologyTools(
    kind: SchemaKind,
    instructions: string,
    input: string,
    tools: any[],
    runId: string,
    webSearch: boolean,
  ): Promise<ModelResult<any>> {
    const schema = schemas[kind];
    const toolTrace: Array<Record<string, unknown>> = [];
    let response = await this.client.responses.create({
      model: this.model,
      instructions: `${instructions}\n\n你可以使用 query_object_set / call_function / propose_action。propose_action 只提案不写图；写图必须等待人工确认。最终仍需输出符合 schema 的结构化结果。`,
      input,
      reasoning: { effort: this.reasoning },
      tools,
    });

    for (let round = 0; round < 4; round++) {
      const calls = ((response.output || []) as any[]).filter((item) => item?.type === "function_call");
      if (!calls.length) break;
      const outputs: any[] = [];
      for (const call of calls) {
        const name = String(call.name || "") as OntologyToolName;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call.arguments || "{}"));
        } catch {
          args = {};
        }
        let toolResult: unknown;
        try {
          toolResult = runOntologyTool(runId, name, args);
        } catch (error) {
          toolResult = { error: error instanceof Error ? error.message : String(error) };
        }
        toolTrace.push({ name, arguments: args, result: toolResult });
        outputs.push({
          type: "function_call_output",
          call_id: String(call.call_id || ""),
          output: JSON.stringify(toolResult).slice(0, 12000),
        });
      }
      response = await this.client.responses.create({
        model: this.model,
        previous_response_id: response.id,
        input: outputs,
        tools,
      });
    }

    const parsed = await this.client.responses.parse({
      model: this.model,
      instructions: "把已有研究过程整理为严格符合 schema 的 JSON。不要发明新的来源 ID。",
      input: [
        { role: "user", content: input },
        { role: "assistant", content: response.output_text || JSON.stringify(toolTrace).slice(0, 20000) },
      ] as any,
      text: { format: zodTextFormat(schema, kind) },
      tools: webSearch ? [{ type: "web_search" as const }] : undefined,
    });
    if (!parsed.output_parsed) throw new Error("模型未返回结构化结果");
    const base = this.result(parsed, parsed.output_parsed, response.output_text || "");
    return {
      ...base,
      toolUsage: {
        ...(typeof base.toolUsage === "object" && base.toolUsage ? base.toolUsage : {}),
        ontology_tool_calls: toolTrace.length,
        ontology_tools: toolTrace.map((item) => item.name),
      },
    };
  }

  private result<T>(response: any, data: T, priorRaw = ""): ModelResult<T> {
    const citations: Citation[] = [];
    let searches = 0;
    for (const item of response.output || []) {
      if (item.type === "web_search_call") searches++;
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === "url_citation" && annotation.url) {
            citations.push({ url: annotation.url, title: annotation.title || annotation.url });
          }
        }
      }
    }
    return {
      data,
      raw: priorRaw ? `${priorRaw}\n\n--- repaired ---\n${response.output_text}` : response.output_text,
      responseId: response.id,
      usage: response.usage || {},
      toolUsage: { web_search_calls: searches },
      citations,
    };
  }
}
