export function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function asItemList(value: unknown, minimum: number): string[] {
  const items = Array.isArray(value)
    ? value.map((item) => String(item ?? ""))
    : typeof value === "string"
      ? value.split("\n")
      : [];
  const normalized = items.map((item) => item.trimEnd());
  while (normalized.length < minimum) normalized.push("");
  return normalized.length ? normalized : Array.from({ length: minimum }, () => "");
}
