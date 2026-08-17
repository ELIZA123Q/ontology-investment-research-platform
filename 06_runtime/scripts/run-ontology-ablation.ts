import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateOntologyAblation, type OntologyAblationCase } from "@/src/evaluation/ontology-ablation";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: npm run eval:ontology:ablation -- <paired-results.json>");
  process.exit(2);
}
const cases = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as OntologyAblationCase[];
const result = evaluateOntologyAblation(cases);
console.log(JSON.stringify(result, null, 2));
if (result.status === "invalid") process.exit(1);
if (result.status !== "ready_for_release_review") console.log("FORMAL_RELEASE_NOT_AUTHORIZED: paired engineering results have not passed every blind/human gate.");
