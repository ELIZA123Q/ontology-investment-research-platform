import { getRun } from "@/storage/db";
import { loadGraphForRun } from "@/skills/ontology/instance_graph";
import { formalRelationOptionsForSource } from "@/skills/ontology/relation_options";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const run = getRun(id);
    if (!run) return Response.json({ error: "研究任务不存在" }, { status: 404 });
    const sourceId = new URL(req.url).searchParams.get("sourceId") || "";
    if (!sourceId) return Response.json({ error: "缺少 sourceId" }, { status: 400 });
    const loaded = loadGraphForRun(id, run.package_path);
    if (loaded.authority !== "formal") {
      return Response.json({ error: "只有正式实例图可以创建关系提案" }, { status: 409 });
    }
    return Response.json({
      source_id: sourceId,
      graph_source: loaded.source,
      relation_options: formalRelationOptionsForSource(loaded.graph, sourceId),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
