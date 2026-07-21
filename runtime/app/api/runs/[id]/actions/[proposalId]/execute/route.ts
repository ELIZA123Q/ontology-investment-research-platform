import { executeApprovedAction } from "@/engine/ontology_tools";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  try {
    const { id, proposalId } = await params;
    const body = await request.json();
    if (!Number.isInteger(body.expected_graph_version)) {
      return Response.json({ error: "请提交期望的关系图版本号（整数）" }, { status: 400 });
    }
    return Response.json(executeApprovedAction(id, proposalId, body.expected_graph_version));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /尚未通过|版本冲突|禁止/.test(message) ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}
