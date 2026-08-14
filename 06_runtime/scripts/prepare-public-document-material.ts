import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const file = process.argv.find((value) => value.startsWith("--file="))?.slice("--file=".length);
const explicitMime = process.argv.find((value) => value.startsWith("--mime="))?.slice("--mime=".length);
if (!file) throw new Error("usage: npm run evidence:prepare-document -- --file=/absolute/path/to/public.pdf [--mime=application/pdf]");
const path = resolve(file);
if (!existsSync(path)) throw new Error(`source file not found: ${path}`);
const bytes = readFileSync(path);
const inferredMime = ({ ".pdf": "application/pdf", ".html": "text/html", ".htm": "text/html", ".txt": "text/plain", ".json": "application/json", ".xml": "application/xml" } as Record<string, string>)[extname(path).toLowerCase()] || "application/pdf";
console.log(JSON.stringify({
  documentAttestation: {
    rawContentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength,
    mimeType: explicitMime || inferredMime,
  },
  boundary: "Paste this optional attestation with a separately verified, locatable original-language excerpt. The file bytes are not uploaded or sent to a model.",
}, null, 2));
