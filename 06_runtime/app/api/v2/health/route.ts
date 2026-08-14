import { NextResponse } from "next/server";
import { defaultDatabasePath, getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = getRuntimeStore();
    store.db.prepare("SELECT 1 AS ok").get();
    return NextResponse.json({ status: "ready", productVersion: "v2", database: defaultDatabasePath() });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
