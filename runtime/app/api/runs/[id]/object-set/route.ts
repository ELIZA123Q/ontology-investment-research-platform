import { getRun } from "@/adapters/db";
import { loadGraphForRun, queryObjectSet, buildProvisionalProjection, summarizeGraph } from "@/engine/instance_graph";
import { supportedActions } from "@/engine/action_executor";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const run = getRun(id);
    if (!run) return Response.json({ error: "研究任务不存在" }, { status: 404 });
    const url = new URL(req.url);
    const loaded = loadGraphForRun(id, run.package_path);
    const includeProvisional = url.searchParams.get("includeProvisional") === "1";
    const result = queryObjectSet(loaded.graph, {
      type: url.searchParams.get("type") || undefined,
      ids: url.searchParams.get("ids")?.split(",").filter(Boolean),
      relatedTo: url.searchParams.get("relatedTo") || undefined,
      relationType: url.searchParams.get("relationType") || undefined,
      direction: (url.searchParams.get("direction") as "out" | "in" | "both") || undefined,
      propertyContains: url.searchParams.get("propertyKey")
        ? { key: url.searchParams.get("propertyKey")!, value: url.searchParams.get("propertyValue") || "" }
        : undefined,
      limit: Number(url.searchParams.get("limit") || 100),
    });
    const provisional = includeProvisional ? buildProvisionalProjection(id) : null;
    return Response.json({
      run_id: id,
      graph_source: loaded.source,
      summary: summarizeGraph(loaded.graph),
      supported_actions: supportedActions(),
      objects: result.objects,
      relations: result.relations,
      total_objects: result.total_objects,
      total_relations: result.total_relations,
      authority: loaded.authority,
      provisional: loaded.provisional,
      provisional_projection: provisional
        ? {
            summary: summarizeGraph(provisional),
            objects: provisional.objects.slice(0, 50),
            note: "草稿预览，尚未写入正式关系图",
          }
        : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
