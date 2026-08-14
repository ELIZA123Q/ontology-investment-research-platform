import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EarningsUpdateReplayFixture } from "@/src/evaluation/earnings-update-replay";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(runtimeRoot, "../05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as EarningsUpdateReplayFixture;
const rawPath = process.argv.find((value) => value.startsWith("--file="))?.slice("--file=".length);
if (!rawPath) throw new Error("usage: npm run eval:earnings:verify-source -- --file=/absolute/path/to/public.pdf");
const absolute = resolve(rawPath);
if (!existsSync(absolute)) throw new Error(`source file not found: ${absolute}`);
const bytes = readFileSync(absolute);
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const result = {
  fixtureId: fixture.id,
  sourceUri: fixture.source.uri,
  expectedHash: fixture.source.rawContentHash,
  actualHash: hash,
  expectedByteLength: fixture.source.byteLength,
  actualByteLength: bytes.byteLength,
  passed: hash === fixture.source.rawContentHash && bytes.byteLength === fixture.source.byteLength,
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
