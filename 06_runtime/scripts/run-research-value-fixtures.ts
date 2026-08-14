import catalogJson from "../../05_control_evaluation/05_evals/fixtures/research-value-fixtures.json";
import { validateResearchValueCatalog, type ResearchValueFixtureCatalog } from "../src/evaluation/research-value-evaluator";

const result = validateResearchValueCatalog(catalogJson as ResearchValueFixtureCatalog);
if (!result.passed) {
  console.error(result.failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`research value fixtures: ${result.fixtures.length}/${result.fixtures.length} ready`);
console.log(`categories: ${[...new Set(result.fixtures.map((fixture) => fixture.category))].sort().join(", ")}`);
console.log("FORMAL_SCORE_NOT_ASSERTED: fixtures and baselines are ready; blinded model runs, calibrated judges and human utility review have not yet been completed.");
