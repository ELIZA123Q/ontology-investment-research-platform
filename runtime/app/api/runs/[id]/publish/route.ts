import { publishAndValidate, exportRunPackage } from "@/adapters/publish_package";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.mode === "export_only") {
      return Response.json(exportRunPackage(id, { approvedOnly: true }));
    }
    return Response.json(publishAndValidate(id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
