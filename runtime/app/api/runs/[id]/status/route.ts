import { getRunStatusSnapshot } from "@/adapters/db_read_models";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const data = getRunStatusSnapshot((await params).id);
  return data
    ? Response.json(data)
    : Response.json({ error: "任务不存在" }, { status: 404 });
}
