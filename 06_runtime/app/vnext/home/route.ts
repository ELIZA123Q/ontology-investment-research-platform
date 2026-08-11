import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { buildHomeView } from "@/src/ui/view-models";
import { identityFromTrustedHeaders } from "@/src/security/runtime-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(buildHomeView(getRuntimeStore(), identityFromTrustedHeaders(request)));
}
