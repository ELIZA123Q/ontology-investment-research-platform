/** Detect encoding damage that makes a frozen quote unsafe for evidence or reader-facing output. */
export function hasUnreadableEncodingArtifacts(value: unknown): boolean {
  const text = String(value ?? "");
  if (!text) return false;
  if (text.includes("\uFFFD") || text.includes("\u0000")) return true;
  // Common UTF-8 decoded as Windows-1252 / Latin-1 sequences.
  if (/(?:Ã.|Â.|â(?:€|€™|€œ|€“|€”|€¦)|ï»¿)/u.test(text)) return true;
  const controlCount = [...text].filter((char) => {
    const code = char.codePointAt(0) || 0;
    return code < 32 && ![9, 10, 13].includes(code);
  }).length;
  return controlCount > 0 && controlCount / Math.max(text.length, 1) > 0.005;
}

export function isReadableEvidenceText(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && !hasUnreadableEncodingArtifacts(text);
}
