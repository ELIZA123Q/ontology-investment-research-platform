import { publishAndValidate, exportRunPackage } from "@/adapters/publish_package";
import { publishFormalPackAndValidate, exportFormalPack } from "@/engine/formal_pack_export";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.mode === "export_only") {
      return Response.json(exportRunPackage(id, { approvedOnly: true }));
    }
    if (body.mode === "workbench_export") {
      return Response.json(publishAndValidate(id));
    }
    if (body.mode === "formal_export_only") {
      return Response.json(exportFormalPack(id));
    }
    // 默认：正式中文命名包 + validate_run
    return Response.json(publishFormalPackAndValidate(id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
