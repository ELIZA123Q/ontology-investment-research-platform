import { createStoredActionProposal, getStoredActionProposals, runOntologyTool, type OntologyToolName } from "@/skills/ontology/tools";
import { supportedActions } from "@/05_governance/ontology_changes/action_executor";

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
      return Response.json({ error: "禁止直接执行操作；请先提出建议、人工批准后再执行" }, { status: 409 });
    }
    return Response.json(createStoredActionProposal(id, String(body.action_id || ""), body.parameters || {}), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
