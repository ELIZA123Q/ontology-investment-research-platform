import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(getWorkbenchApplication().health());
  } catch (error) {
    return NextResponse.json({ status: "unavailable", error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
