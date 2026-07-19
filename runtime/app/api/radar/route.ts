import { radarBundle } from "@/adapters/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(radarBundle());
}
