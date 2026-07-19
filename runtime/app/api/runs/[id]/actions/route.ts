import { createStoredActionProposal, getStoredActionProposals, runOntologyTool, type OntologyToolName } from "@/engine/ontology_tools";
import { supportedActions } from "@/engine/action_executor";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({
    supported_actions: supportedActions(),
    tools: ["query_object_set", "call_function", "propose_action"],
    proposals: getStoredActionProposals(id),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const mode = String(body.mode || "propose");
    if (mode === "tool") {
      const name = String(body.tool || "") as OntologyToolName;
      return Response.json(runOntologyTool(id, name, body.arguments || {}));
    }
    if (mode === "execute") {
      return Response.json({ error: "禁止直接执行 Action；请先创建提案、批准工作项，再调用提案执行接口" }, { status: 409 });
    }
    return Response.json(createStoredActionProposal(id, String(body.action_id || ""), body.parameters || {}), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
