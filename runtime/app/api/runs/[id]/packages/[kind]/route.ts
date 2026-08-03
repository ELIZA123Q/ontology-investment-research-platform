import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { getRun } from "@/adapters/db";
import { parseJson } from "@/engine/types";

export const runtime = "nodejs";

function archiveFiles(root: string, dir = root): Record<string, Uint8Array> {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return Object.entries(archiveFiles(root, absolute));
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    return [[relative, new Uint8Array(readFileSync(absolute))] as [string, Uint8Array]];
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const { id, kind } = await params;
    if (!["delivery", "audit"].includes(kind)) throw new Error("发布制品类型只允许 delivery 或 audit");
    if (kind === "audit" && process.env.WORKBENCH_ALLOW_AUDIT_DOWNLOAD !== "true") {
      return Response.json({ error: "内部审计包下载未授权；请由管理员在受控环境启用。" }, { status: 403 });
    }
    const run = getRun(id);
    if (!run) throw new Error("研究任务不存在");
    const manifest = parseJson<Record<string, any>>(run.manifest_json, {});
    const release = manifest.release_set;
    if (!release?.release_id) throw new Error("当前研究尚未生成双制品发布集");
    const item = kind === "delivery" ? release.formal_delivery_pack : release.research_audit_pack;
    const root = String(item?.export_dir || "");
    if (!root || !statSync(root).isDirectory()) throw new Error("发布制品目录不存在");
    const zipped = zipSync(archiveFiles(root), { level: 6 });
    return new Response(zipped, { headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename=${kind}-${release.release_id}.zip`,
      "x-release-id": release.release_id,
      "x-package-kind": kind === "delivery" ? "formal_delivery_pack" : "research_audit_pack",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
