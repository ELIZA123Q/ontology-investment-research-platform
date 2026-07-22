import { z } from "zod";
import { schemas } from "./schemas";
import { radarOutputSchema } from "./radar_schema";
import {
  controlledScopePatchSchema,
  controlledStructurePatchSchema,
  controlledEvidencePatchSchema,
  controlledJudgmentPatchSchema,
  structureValidationResultSchema,
} from "./revise_schemas";

export {
  STRUCTURED_SCHEMA_CONTRACT_PREFIX,
  assertModelStructuredSchema,
  modelOptional,
} from "./model_schema_helpers";

export const MODEL_STRUCTURED_SCHEMAS = {
  ...schemas,
  scope_revise: controlledScopePatchSchema,
  structure_revise: controlledStructurePatchSchema,
  judgment_revise: controlledJudgmentPatchSchema,
  evidence_supplement: controlledEvidencePatchSchema,
  structure_validate: structureValidationResultSchema,
  market_radar: radarOutputSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

export type ModelStructuredSchemaName = keyof typeof MODEL_STRUCTURED_SCHEMAS;
