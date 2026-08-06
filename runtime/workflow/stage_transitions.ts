import "server-only";

export {
  classifyRuntimeFailure,
  compactStructuredArtifact,
  compactStage03ForUpstream,
  formatRuntimeFailureMessage,
  shouldRetryRuntimeFailure,
  type RuntimeFailureCategory,
} from "./support";

export {
  validateOntologyVariableBindings,
  methodCandidatesForPrompt,
  upstreamJudgmentTypes,
  sourcesForPrompt,
  sourceForFrozenBaseline,
  normalizeBusinessCutoff,
  stageNumber,
  editArtifact,
  validateGeneratedSemanticDraft,
} from "./shared";

export { validateApproval } from "./validate_approval";

export {
  normalizeStage01Projection,
  createStage01DeterministicProjection,
  createControlledStructureProjection,
  buildEvidenceGapFallback,
  repairEvidencePreparationDraft,
  createEvidenceGapFallback,
  createControlledEvidenceProjection,
  createControlledJudgmentProjection,
  buildJudgmentGapFallback,
  createJudgmentGapFallback,
  normalizeStage05Projection,
  createStage05DeterministicProjection,
  createControlledIndependentReview,
} from "./projections";

export {
  reviseRunStage,
  heuristicStructureIssues,
  structureValidationIssueConflictsWithContract,
  approvedDownstreamStages,
  activeSceneToDefaultStage,
  normalizeTargetStage,
} from "../skills/replan/workflow_revise";

export { approve } from "./approval";
export { validateStage02ForApproval } from "./stage02_review";
export { generateArtifact } from "./orchestrator";
export { cancelGeneration } from "./cancel";
export { applyIncrementalChangeSet } from "../skills/replan/change_set_apply";
export { clarifyStage01 } from "./clarify";
export { runResearchPipeline } from "./controller";
export type { PipelineConfig, PipelineResult, StagePipelineResult } from "./controller";
