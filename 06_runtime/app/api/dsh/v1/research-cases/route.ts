import { NextResponse } from "next/server";
import { getWorkbenchApplication, type CreateResearchCaseInput } from "@/src/application/workbench-service";
import { assertDshGatewayAuthorized, dshGatewayErrorResponse } from "@/src/dsh/gateway-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertDshGatewayAuthorized(request);
    return NextResponse.json({ apiVersion: "v1", researchCases: getWorkbenchApplication().listResearchCases() });
  } catch (error) {
    const response = dshGatewayErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    assertDshGatewayAuthorized(request);
    const researchCase = getWorkbenchApplication().createResearchCase(await request.json() as CreateResearchCaseInput);
    return NextResponse.json({ apiVersion: "v1", researchCase }, { status: 201 });
  } catch (error) {
    const response = dshGatewayErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
