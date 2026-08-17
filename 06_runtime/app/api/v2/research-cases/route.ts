import { NextResponse } from "next/server";
import { getWorkbenchApplication, type CreateResearchCaseInput } from "@/src/application/workbench-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getWorkbenchApplication().listResearchCases());
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as CreateResearchCaseInput;
    return NextResponse.json(getWorkbenchApplication().createResearchCase(input), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
