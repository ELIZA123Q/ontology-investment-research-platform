export function assertInternalAdmin(request: Request): void {
  const configured = process.env.VNEXT_INTERNAL_ADMIN_TOKEN?.trim();
  if (!configured) {
    const host = new URL(request.url).hostname;
    if (host === "127.0.0.1" || host === "localhost" || process.env.NODE_ENV === "test") return;
    throw new Error("VNEXT_INTERNAL_ADMIN_TOKEN is required outside localhost");
  }
  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${configured}`) throw new Error("Unauthorized");
}

export function adminError(error: unknown): { body: { error: string }; status: number } {
  const message = error instanceof Error ? error.message : String(error);
  return { body: { error: message }, status: message === "Unauthorized" ? 401 : 400 };
}
