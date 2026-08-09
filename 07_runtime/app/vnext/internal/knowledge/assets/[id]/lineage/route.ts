import { NextResponse } from "next/server";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertInternalAdmin(request);
    const { id } = await context.params;
    return NextResponse.json(getRuntimeStore().assetLineage(id));
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
