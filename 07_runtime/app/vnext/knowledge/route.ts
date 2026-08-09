import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { buildPublicLibraryView } from "@/src/ui/view-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildPublicLibraryView(getRuntimeStore()));
}
