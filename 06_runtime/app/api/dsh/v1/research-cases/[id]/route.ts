import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { assertDshGatewayAuthorized, dshGatewayErrorResponse } from "@/src/dsh/gateway-auth";
import { projectResearchCaseSnapshotForDsh } from "@/src/dsh/model-visible-projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDshGatewayAuthorized(request);
    const { id } = await context.params;
    return NextResponse.json({ apiVersion: "v1", ...projectResearchCaseSnapshotForDsh(getWorkbenchApplication().researchCaseSnapshot(id)) });
  } catch (error) {
    const response = dshGatewayErrorResponse(error);
    const status = response.status === 400 ? 404 : response.status;
    return NextResponse.json(response.body, { status });
  }
}
