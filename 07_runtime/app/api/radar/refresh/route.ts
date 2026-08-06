import { refreshMarketRadar } from "@/market_radar";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lookbackHours = Math.min(168, Math.max(1, Number(body.lookback_hours || 72)));
    return Response.json(await refreshMarketRadar(undefined, lookbackHours));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
