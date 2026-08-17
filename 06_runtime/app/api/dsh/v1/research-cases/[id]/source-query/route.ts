import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { assertDshGatewayAuthorized, dshGatewayErrorResponse } from "@/src/dsh/gateway-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDshGatewayAuthorized(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const query = String(body.query || "").trim();
    if (!query) throw new Error("query is required");
    const researchCase = getWorkbenchApplication().getResearchCase(id);
    if (!researchCase) return NextResponse.json({ error: "ResearchCase not found" }, { status: 404 });
    const result = await getWorkbenchApplication().queryAndIngestSource(researchCase.taskId, {
      companyCode: researchCase.companyCode,
      companyName: researchCase.companyName,
      asOf: researchCase.asOf,
      query,
      reportPeriod: body.reportPeriod ? String(body.reportPeriod) : undefined,
      maxResults: body.maxResults === undefined ? undefined : Number(body.maxResults),
    });
    return NextResponse.json({
      apiVersion: "v1", researchCaseId: researchCase.id, taskId: researchCase.taskId,
      artifactId: result.artifact.id, artifactVersion: result.artifact.version, trace: result.trace,
    }, { status: 202 });
  } catch (error) {
    const response = dshGatewayErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
