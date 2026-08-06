import { zipSync, strToU8 } from "fflate";
import { archiveDigest, buildRunArchive, getArchiveFilePayload } from "@/runner/run_archive";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const archive = buildRunArchive(id);
    const content = Object.fromEntries(
      archive.files.map((file) => {
        const payload = getArchiveFilePayload(id, file.id);
        return [file.file_name, strToU8(payload.content)];
      }),
    );
    content["README.txt"] = strToU8(
      [
        `run_id: ${archive.run_id}`,
        `question: ${archive.run_question}`,
        `generated_at: ${archive.generated_at}`,
        `file_count: ${archive.summary.total_files}`,
      ].join("\n"),
    );
    const zipped = zipSync(content, { level: 6 });
    return new Response(zipped, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename=run-${archive.run_id.slice(0, 8)}-archive-${archiveDigest(archive)}.zip`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
