import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve(process.cwd(), "../03_agent_capability/02_skills/evidence_research/references/public_evidence_sources.json");
const outputPath = resolve(process.cwd(), "src/capabilities/generated-evidence-sources.ts");
const checkOnly = process.argv.includes("--check");
const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as { schemaVersion: string; reviewedAt: string; policy: Record<string, boolean>; sources: Array<Record<string, unknown>> };

if (!/^\d+\.\d+\.\d+$/u.test(parsed.schemaVersion)) throw new Error("evidence source catalog schemaVersion is invalid");
if (Number.isNaN(Date.parse(parsed.reviewedAt))) throw new Error("evidence source catalog reviewedAt is invalid");
const ids = parsed.sources.map((item) => String(item.id || "").trim());
if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("evidence source catalog IDs must be non-empty and unique");
for (const item of parsed.sources) {
  if (!Array.isArray(item.channels) || !item.channels.length) throw new Error(`${item.id} has no acquisition channel`);
  if (!Array.isArray(item.subjects) || !item.subjects.length) throw new Error(`${item.id} has no subject coverage`);
  for (const channel of item.channels as Array<Record<string, unknown>>) {
    const endpoint = String(channel.endpoint || "");
    if (!endpoint || (!/^https:\/\//u.test(endpoint) && !/^[a-z0-9_-]+$/u.test(endpoint))) throw new Error(`${item.id} has an invalid endpoint`);
  }
}

const generated = `// Generated from 03_agent_capability/02_skills/evidence_research/references/public_evidence_sources.json. Do not edit.\nexport const EVIDENCE_SOURCE_CATALOG = ${JSON.stringify(parsed, null, 2)} as const;\n`;
if (checkOnly) {
  if (readFileSync(outputPath, "utf8") !== generated) throw new Error("generated evidence source catalog is stale; run npm run evidence:sources:sync");
  process.stdout.write(`checked ${parsed.sources.length} evidence sources\n`);
} else {
  writeFileSync(outputPath, generated);
  process.stdout.write(`generated ${parsed.sources.length} evidence sources\n`);
}
