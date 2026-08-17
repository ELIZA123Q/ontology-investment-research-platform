import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { assertConnectorRequestAuthorized, ConnectorIngestionError, validateConnectorEnvelope } from "@/src/tools/connector-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 5_000_000) throw new ConnectorIngestionError("Connector envelope exceeds 5 MB", 413);
    assertConnectorRequestAuthorized(request);
    const envelope = validateConnectorEnvelope(await request.json());
    const artifact = getWorkbenchApplication().ingestConnector(envelope);
    return NextResponse.json({ artifactId: artifact.id, artifactVersion: artifact.version, taskId: artifact.taskId, kind: envelope.kind }, { status: 202 });
  } catch (error) {
    const status = error instanceof ConnectorIngestionError ? error.status : error instanceof Error && error.name === "EvidenceIngestionConflictError" ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
