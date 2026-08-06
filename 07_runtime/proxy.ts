import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isLoopbackHost(rawHost: string) {
  const host = rawHost.trim().toLowerCase();
  return /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/.test(host);
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (!isLoopbackHost(host)) return NextResponse.json({ error: "Runtime API 只接受本机回环 Host" }, { status: 403 });

  if (MUTATING_METHODS.has(request.method.toUpperCase())) {
    const fetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
    if (fetchSite === "cross-site") return NextResponse.json({ error: "拒绝跨站写入本机 Runtime API" }, { status: 403 });
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try { originHost = new URL(origin).host.toLowerCase(); } catch { return NextResponse.json({ error: "Origin 非法" }, { status: 403 }); }
      if (originHost !== host.toLowerCase()) return NextResponse.json({ error: "Origin 与 Runtime Host 不一致" }, { status: 403 });
    }
  }

  const response = NextResponse.next();
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export const config = { matcher: "/api/:path*" };
