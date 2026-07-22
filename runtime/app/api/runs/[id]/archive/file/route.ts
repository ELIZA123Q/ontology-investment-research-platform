import { getArchiveFilePayload } from "@/engine/run_archive";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const fileId = url.searchParams.get("fileId");
    if (!fileId) return Response.json({ error: "缺少 fileId" }, { status: 400 });
    const payload = getArchiveFilePayload(id, fileId);
    return new Response(payload.content, {
      headers: {
        "content-type": `${payload.entry.mime}; charset=utf-8`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
