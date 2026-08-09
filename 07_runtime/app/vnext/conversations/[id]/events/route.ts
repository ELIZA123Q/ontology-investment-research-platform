import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const fromQuery = Number(url.searchParams.get("after") || 0);
  const fromHeader = Number(request.headers.get("last-event-id") || 0);
  let cursor = Math.max(fromQuery, fromHeader);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const push = () => {
        const events = getRuntimeStore().listEvents(id, cursor, 200);
        for (const event of events) {
          cursor = event.sequence;
          controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`));
        }
        if (!events.length) controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      };
      push();
      timer = setInterval(push, 800);
      timeout = setTimeout(() => { if (timer) clearInterval(timer); controller.close(); }, 25_000);
    },
    cancel() { if (timer) clearInterval(timer); if (timeout) clearTimeout(timeout); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
