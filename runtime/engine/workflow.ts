import "server-only";

export {
  classifyRuntimeFailure,
  compactStructuredArtifact,
  compactStage03ForUpstream,
  formatRuntimeFailureMessage,
  shouldRetryRuntimeFailure,
  type RuntimeFailureCategory,
} from "./workflow_support";

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
} from "./workflow_shared";

export { validateApproval } from "./workflow/validate_approval";

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
} from "./workflow_projections";

export {
  reviseRunStage,
  heuristicStructureIssues,
  structureValidationIssueConflictsWithContract,
  approvedDownstreamStages,
  activeSceneToDefaultStage,
  normalizeTargetStage,
} from "./workflow_revise";

export { approve } from "./workflow/approve";
export { validateStage02ForApproval } from "./workflow/stage02_review";
export { generateArtifact } from "./workflow/generate";
export { cancelGeneration } from "./workflow/cancel";
export { applyIncrementalChangeSet } from "./workflow/change_set_apply";
export { clarifyStage01 } from "./workflow/clarify";
