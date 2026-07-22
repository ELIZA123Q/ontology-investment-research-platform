import { getArtifactFormatContent } from "@/engine/run_archive";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") || "json") as "json" | "md" | "yaml";
    if (!["json", "md", "yaml"].includes(format)) {
      return Response.json({ error: "format 仅支持 json|md|yaml" }, { status: 400 });
    }
    const file = getArtifactFormatContent(id, artifactId, format);
    return new Response(file.content, {
      headers: {
        "content-type": file.mime,
        "content-disposition": `attachment; filename=${file.filename}`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
