import { executeProposedAction, runOntologyTool, type OntologyToolName } from "@/engine/ontology_tools";
import { supportedActions } from "@/engine/action_executor";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ supported_actions: supportedActions(), tools: ["query_object_set", "call_function", "propose_action"] });
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
      return Response.json(executeProposedAction(id, String(body.action_id || ""), body.parameters || {}));
    }
    return Response.json(runOntologyTool(id, "propose_action", { action_id: body.action_id, parameters: body.parameters || {} }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
