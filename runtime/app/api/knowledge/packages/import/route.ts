import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { repositoryPath } from "@/adapters/repo-paths";
import { validateKnowledgePackageFiles } from "@/engine/knowledge_package";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) throw new Error("请上传知识包 ZIP");
    const archive = unzipSync(bytes);
    const files = new Map(Object.entries(archive).map(([name, content]) => [name, strFromU8(content)]));
    const result = validateKnowledgePackageFiles(files);
    if (!result.ok) return Response.json({ ...result, admission: "rejected" }, { status: 400 });
    const packageId = result.manifest.package_id;
    if (!/^[A-Z0-9_-]+$/.test(packageId)) throw new Error("知识包 package_id 非法");
    const candidateDir = repositoryPath("instances", "00_本机运行", "knowledge_candidates", packageId);
    mkdirSync(candidateDir, { recursive: true });
    writeFileSync(path.join(candidateDir, "candidate.zip"), bytes);
    writeFileSync(path.join(candidateDir, "candidate.json"), JSON.stringify({
      schema_name: "knowledge_candidate_admission",
      schema_version: "1.0.0",
      package_id: packageId,
      package_kind: result.manifest.package_kind,
      content_fingerprint: result.manifest.content_fingerprint,
      status: "pending_expert_review",
      admitted_at: new Date().toISOString(),
      rule: "候选导入不得直接覆盖正式知识基线",
    }, null, 2));
    return Response.json({
      ok: true,
      package_id: packageId,
      status: "pending_expert_review",
      note: "已进入知识候选区；只有专家审阅通过后才能发布正式知识版本。",
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
