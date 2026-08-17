import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { assertConnectorRequestAuthorized, ConnectorIngestionError } from "@/src/tools/connector-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertConnectorRequestAuthorized(request);
    const body = await request.json() as Record<string, unknown>;
    const taskId = String(body.taskId || "").trim();
    const companyCode = String(body.companyCode || "").trim();
    const companyName = String(body.companyName || "").trim();
    const query = String(body.query || "").trim();
    const asOf = String(body.asOf || "").trim();
    if (!taskId || !companyCode || !companyName || !query || !asOf) throw new ConnectorIngestionError("taskId, companyCode, companyName, query and asOf are required", 400);
    const result = await getWorkbenchApplication().queryAndIngestSource(taskId, {
      companyCode, companyName, query, asOf,
      reportPeriod: body.reportPeriod ? String(body.reportPeriod) : undefined,
      maxResults: body.maxResults === undefined ? undefined : Number(body.maxResults),
    });
    return NextResponse.json({ artifactId: result.artifact.id, artifactVersion: result.artifact.version, taskId, trace: result.trace }, { status: 202 });
  } catch (error) {
    const status = error instanceof ConnectorIngestionError ? error.status : error instanceof Error && error.name === "EvidenceIngestionConflictError" ? 409 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
