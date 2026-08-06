import { deleteRun, getRun, getRunBundle } from "@/storage/db";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getRunBundle(id);
  return data ? Response.json(data) : Response.json({ error: "任务不存在" }, { status: 404 });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getRun(id)) {
    return Response.json({ error: "任务不存在" }, { status: 404 });
  }
  try {
    const result = deleteRun(id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
