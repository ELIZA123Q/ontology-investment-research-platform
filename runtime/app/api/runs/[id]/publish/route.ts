import { publishAndValidate, exportRunPackage } from "@/export/publish_package";
import { publishFormalPackAndValidate, exportFormalPack } from "@/export/formal_pack_export";
import { publishReleaseSetAndValidate } from "@/export/release_set";

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
    if (body.mode === "legacy_formal_pack") {
      return Response.json(publishFormalPackAndValidate(id));
    }
    // 默认：同一 release_id 下原子生成对外交付包与内部审计包。
    return Response.json(publishReleaseSetAndValidate(id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
