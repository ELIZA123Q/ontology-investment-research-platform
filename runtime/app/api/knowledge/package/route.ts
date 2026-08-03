import { strToU8, zipSync } from "fflate";
import { buildKnowledgePackage, knowledgePackageDigest } from "@/engine/knowledge_package";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedKind = url.searchParams.get("kind");
    const runId = url.searchParams.get("runId");
    if (requestedKind && !["knowledge_baseline", "knowledge_task_slice"].includes(requestedKind)) {
      throw new Error("kind 只允许 knowledge_baseline 或 knowledge_task_slice");
    }
    if (requestedKind === "knowledge_task_slice" && !runId) throw new Error("任务知识切片必须提供 runId");
    if (requestedKind === "knowledge_baseline" && runId) throw new Error("知识基线包不能绑定 runId");
    const bundle = buildKnowledgePackage(runId);
    const zipped = zipSync(
      Object.fromEntries(bundle.files.map((file) => [file.file_name, strToU8(file.content)])),
      { level: 6 },
    );
    const scope = bundle.run_id ? `task-${bundle.run_id.slice(0, 8)}` : "baseline";
    return new Response(zipped, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename=${bundle.package_kind}-${scope}-${knowledgePackageDigest(bundle)}.zip`,
        "x-ontology-fingerprint": bundle.fingerprint,
        "x-knowledge-package-id": bundle.package_id,
        "x-knowledge-package-kind": bundle.package_kind,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
