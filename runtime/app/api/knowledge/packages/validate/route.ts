import { strFromU8, unzipSync } from "fflate";
import { validateKnowledgePackageFiles } from "@/engine/knowledge_package";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) throw new Error("请上传知识包 ZIP");
    const archive = unzipSync(bytes);
    const files = new Map(Object.entries(archive).map(([name, content]) => [name, strFromU8(content)]));
    const result = validateKnowledgePackageFiles(files);
    return Response.json({
      ...result,
      admission: result.ok ? "candidate_ready" : "rejected",
      note: result.ok
        ? "校验通过，仅可进入知识候选区；正式发布仍需专家审阅。"
        : "校验失败，未进入知识候选区。",
    }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
