import { NextResponse, type NextRequest } from "next/server";
import { authorizeRuntimeRequest, RuntimeAccessError } from "@/src/security/runtime-access";

export function proxy(request: NextRequest) {
  try {
    const identity = authorizeRuntimeRequest(request);
    const headers = new Headers(request.headers);
    headers.set("x-vnext-auth-tenant", identity.tenantId);
    headers.set("x-vnext-auth-user", identity.userId);
    headers.set("x-vnext-auth-roles", identity.roles.join(","));
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("x-frame-options", "DENY");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    response.headers.set("content-security-policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return response;
  } catch (error) {
    const status = error instanceof RuntimeAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export const config = { matcher: ["/ontology/:path*"] };
