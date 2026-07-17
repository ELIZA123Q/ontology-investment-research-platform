import { createRun, listRuns } from "@/adapters/db";
import { defaultExamplePackages } from "@/engine/instance_graph";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ runs: listRuns(), example_packages: defaultExamplePackages() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = String(body.question || "").trim();
    const domain = String(body.domain || "semiconductor");
    const packagePath = body.package_path ? String(body.package_path) : null;
    if (!question) return Response.json({ error: "请输入研究问题" }, { status: 400 });
    return Response.json(createRun(question, domain, packagePath), { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
