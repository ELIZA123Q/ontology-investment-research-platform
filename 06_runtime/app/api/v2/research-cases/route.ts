import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { ResearchCaseService, type CreateResearchCaseInput } from "@/src/runtime-v2/research-case-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(new ResearchCaseService(getRuntimeStore()).list());
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as CreateResearchCaseInput;
    return NextResponse.json(new ResearchCaseService(getRuntimeStore()).create(input), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
