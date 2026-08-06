/**
 * 模型 structured output / strict function schema 约定：
 * - 缺省字段用 modelOptional(x) 或 .nullable()，禁止裸 .optional()
 * - 新增 generateStructured schema 必须登记进 MODEL_STRUCTURED_SCHEMAS
 */
import { zodFunction } from "openai/helpers/zod";
import { z } from "zod";

export const STRUCTURED_SCHEMA_CONTRACT_PREFIX = "[structured_schema_contract]";

/** 模型提交字段缺省：nullable + optional，兼容旧产物缺字段与 API required 约束。 */
export function modelOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullable().optional();
}

export function assertModelStructuredSchema(name: string, schema: z.ZodTypeAny): void {
  const submitName = `submit_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  try {
    zodFunction({
      name: submitName,
      description: `Contract check for ${name}`,
      parameters: schema,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${STRUCTURED_SCHEMA_CONTRACT_PREFIX} ${name}: ${detail}`);
  }
}
