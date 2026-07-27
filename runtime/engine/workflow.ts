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
  validateApproval,
  methodCandidatesForPrompt,
  upstreamJudgmentTypes,
  sourcesForPrompt,
  sourceForFrozenBaseline,
  normalizeBusinessCutoff,
  stageNumber,
  editArtifact,
  validateGeneratedSemanticDraft,
} from "./workflow_shared";

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
  validateStage02ForApproval,
  heuristicStructureIssues,
  structureValidationIssueConflictsWithContract,
  approvedDownstreamStages,
  activeSceneToDefaultStage,
  normalizeTargetStage,
} from "./workflow_revise";

export { approve } from "./workflow/approve";
export { generateArtifact } from "./workflow/generate";
export { cancelGeneration } from "./workflow/cancel";
export { applyIncrementalChangeSet } from "./workflow/change_set_apply";
export { clarifyStage01 } from "./workflow/clarify";
