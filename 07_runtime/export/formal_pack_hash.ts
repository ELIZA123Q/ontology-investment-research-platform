import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fileSha256(file: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

export function formalArtifactSha256(artifact: string): string {
  if (statSync(artifact).isFile()) return fileSha256(artifact);
  const digest = createHash("sha256");
  const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? visit(path.join(dir, entry.name))
      : [path.join(dir, entry.name)]);
  for (const child of visit(artifact).sort()) {
    const relative = path.relative(artifact, child).split(path.sep).join("/");
    digest.update(relative);
    digest.update("\0");
    digest.update(fileSha256(child));
    digest.update("\n");
  }
  return `sha256:${digest.digest("hex")}`;
}

/** 与 05_governance/03_校验/validate_run.py::_stage_hash 完全一致。 */
export function formalStageHash(exportDir: string, artifacts: string[]): string {
  const payload = [...artifacts].sort().map((relative) => ({
    path: relative,
    hash: formalArtifactSha256(path.join(exportDir, relative)),
  }));
  return `sha256:${createHash("sha256").update(stableJson(payload)).digest("hex")}`;
}
