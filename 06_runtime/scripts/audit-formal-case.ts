import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateFormalCaseEligibility,
  hashFormalEvidenceBundle,
  type FormalEvaluationCaseManifest,
} from "@/src/evaluation/formal-case-eligibility";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("usage: npm run eval:formal:audit -- <manifest.json>");

const absolutePath = resolve(process.cwd(), manifestPath);
const manifest = JSON.parse(readFileSync(absolutePath, "utf8")) as FormalEvaluationCaseManifest;
const result = evaluateFormalCaseEligibility(manifest);
const evidenceReadyChecks = new Set([
  "task_input", "evidence_bundle_integrity", "evidence_contract", "cutoff",
  "independent_sources", "stratum_evidence_boundary", "objective_checks", "perturbations",
]);
const evidenceReady = result.checks.filter((item) => evidenceReadyChecks.has(item.id)).every((item) => item.passed);
process.stdout.write(`${JSON.stringify({
  manifestPath: absolutePath,
  evidenceBundleHash: manifest.evidenceBundle.hash,
  expectedEvidenceBundleHash: hashFormalEvidenceBundle(manifest.evidenceBundle.evidence),
  evidenceReady,
  ...result,
}, null, 2)}\n`);

if (process.argv.includes("--require-eligible") && result.status !== "eligible") process.exitCode = 2;
if (process.argv.includes("--require-evidence-ready") && !evidenceReady) process.exitCode = 3;
