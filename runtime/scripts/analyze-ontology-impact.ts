import { execFileSync } from "node:child_process";
import {
  analyzeOntologyImpact,
  buildOntologySemanticManifest,
  buildOntologySemanticManifestFromModelSources,
} from "../skills/ontology/impact";
import { ONTOLOGY_MODEL_FILES } from "../skills/ontology/catalog_loader";

const refIndex = process.argv.indexOf("--git-base");
const gitBase = refIndex >= 0 ? String(process.argv[refIndex + 1] || "HEAD") : "HEAD";
const sources: Record<string, string> = {};
for (const file of ONTOLOGY_MODEL_FILES) {
  const path = `ontology/01_通用/models/${file}`;
  sources[path] = execFileSync("git", ["show", `${gitBase}:${path}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

const previous = buildOntologySemanticManifestFromModelSources(sources);
const current = buildOntologySemanticManifest();
const report = analyzeOntologyImpact(previous, current);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
