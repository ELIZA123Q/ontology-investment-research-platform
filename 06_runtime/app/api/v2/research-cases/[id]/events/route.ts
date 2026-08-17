import { getWorkbenchApplication } from "@/src/application/workbench-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const application = getWorkbenchApplication();
  const researchCase = application.getResearchCase(id);
  if (!researchCase) return Response.json({ error: "ResearchCase not found" }, { status: 404 });
  const url = new URL(request.url);
  let cursor = Math.max(Number(url.searchParams.get("after") || 0), Number(request.headers.get("last-event-id") || 0));
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const push = () => {
        const events = application.listResearchCaseEvents(id, cursor, 200) || [];
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
