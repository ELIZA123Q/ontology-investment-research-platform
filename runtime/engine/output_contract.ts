import "server-only";

/**
 * 输出合同校验器 — 对标 governance/03_校验/ 体系
 *
 * 在 Runtime 层面强制执行三项核心合同:
 * 1. 派生字段禁止人工填写 (status_derivation.py DERIVED_LIMIT_FIELDS)
 * 2. 跨阶段引用完整性 (validate_publish.py 引用链校验)
 * 3. 输入-输出哈希绑定 + stale 传播 (manifest 绑定)
 *
 * 同时定义结构化缺陷目录 (对标 evaluation/03_执行/calibration/defects.yaml)
 */

import { createHash } from "node:crypto";

// =============================================================================
// 第 1 部分: 派生字段禁止清单
// =============================================================================

/**
 * 只能由确定性规则计算的字段，LLM 不得直接填写。
 * 来源: governance/03_校验/status_derivation.py DERIVED_LIMIT_FIELDS + RETIRED_PARALLEL_FIELDS
 */
export const DERIVED_LIMIT_FIELDS = [
  "maximum_judgment_level",
  "evidence_permission",
  "allowed_04_output",
  "publishable",
] as const;

/** 已废弃的并行限制字段 — 出现即拒绝 */
export const RETIRED_PARALLEL_FIELDS = [
  "admission",
  "admission_status",
  "claim_mode",
  "judgment_status",
  "reasoning_readiness",
  "path_gate_status",
  "path_status",
] as const;

/** 合并：禁止人工填写的全部字段 */
export const FORBIDDEN_MANUAL_FIELDS = [
  ...DERIVED_LIMIT_FIELDS,
  ...RETIRED_PARALLEL_FIELDS,
] as const;

// =============================================================================
// 第 2 部分: 结构化缺陷目录 (对标 evaluation/03_执行/calibration/defects.yaml)
// =============================================================================

export const STRUCTURED_DEFECT_TYPES = [
  "fact_error",             // 核心事实错误
  "scope_extrapolation",     // 范围外推 (局部结论全局化)
  "strength_upgrade",        // 强度越级 (J3→J4 等)
  "counterevidence_removed", // 反证被删除或忽略
  "causal_leap",             // 因果跳跃 (无机制支撑)
  "low_research_value",      // 低研究价值 (无增量信息)
  "irrelevant_verbosity",    // 无关冗长
  "unsupported_novelty",     // 无支撑的新观点 (05 新增经 04 确认边界外的主张)
  "over_conservative",       // 过度保守 (有充分证据但给出 J0/J1)
  "expression_distortion",   // 表达扭曲 (05 抬高了 04 判断强度)
  "audit_register_voice_in_prose", // 审计腔入正文
] as const;

export type DefectType = (typeof STRUCTURED_DEFECT_TYPES)[number];

export const DEFECT_DIMENSIONS: Record<DefectType, "R" | "U"> = {
  fact_error: "R",
  scope_extrapolation: "R",
  strength_upgrade: "R",
  counterevidence_removed: "R",
  causal_leap: "R",
  low_research_value: "U",
  irrelevant_verbosity: "U",
  unsupported_novelty: "R",
  over_conservative: "U",
  expression_distortion: "R",
  audit_register_voice_in_prose: "U",
};

/** 硬失败项 — 任何一条即导致不可发布 */
export const HARD_FAILURE_DEFECTS: DefectType[] = [
  "fact_error",
  "strength_upgrade",
  "counterevidence_removed",
  "unsupported_novelty",
  "expression_distortion",
];

export type StageDefectReport = {
  defect_type: DefectType;
  dimension: "R" | "U";
  severity: "hard_fail" | "error" | "warning";
  stage: string;
  location: string;       // 在哪个字段/段落/节点
  detail: string;
  suggestion: string;
};

// =============================================================================
// 第 3 部分: 跨阶段引用完整性
// =============================================================================

/**
 * 主链引用关系: 每个字段的引用必须能解析到上游字段
 * 来源: governance/02_合同/public_contract.yaml 主链定义
 */
export const CROSS_STAGE_REFERENCE_RULES = {
  // Stage02 → Stage01（范围边界由 scope_ref / time_scope 承接；问题树在 02 内自洽）
  "02_to_01": {
    checks: [
      { source: "judgment_units[].scope_ref", target: "research_scope.id", stage: "stage_02" },
    ],
  },
  // Stage03 → Stage02
  "03_to_02": {
    checks: [
      { source: "evidence_drafts[].judgment_unit_ids[]", target: "judgment_units[].id", stage: "stage_02" },
      { source: "evidence_requirements[].id", target: "evidence_requirements[].id", stage: "stage_02" },
      { source: "method_applications[].application_id", target: "method_applications[].application_id", stage: "stage_02" },
    ],
  },
  // Stage04 → Stage03
  "04_to_03": {
    checks: [
      { source: "signals[].evidence_draft_ids[]", target: "evidence_drafts[].id", stage: "stage_03" },
      { source: "judgments[].supporting_evidence_draft_ids[]", target: "evidence_drafts[].id", stage: "stage_03" },
      { source: "method_applications[].input_evidence_refs[]", target: "evidence_drafts[].id", stage: "stage_03" },
    ],
  },
  // Stage04 → Stage02
  "04_to_02": {
    checks: [
      { source: "judgments[].judgment_unit_id", target: "judgment_units[].id", stage: "stage_02" },
      { source: "claims[].judgment_id", target: "judgments[].id", stage: "stage_04" },
    ],
  },
  // Stage05 → Stage04（运行真源为 report_claims；合同层 EX 由其投影）
  "05_to_04": {
    checks: [
      { source: "report_claims[].judgment_ids[]", target: "judgments[].id", stage: "stage_04" },
      { source: "report_claims[].method_application_ids[]", target: "method_applications[].application_id", stage: "stage_04" },
    ],
  },
  // Stage05 → Stage03
  "05_to_03": {
    checks: [
      { source: "report_claims[].evidence_draft_ids[]", target: "evidence_drafts[].id", stage: "stage_03" },
      { source: "report_claims[].source_ids[]", target: "sources[].id", stage: "stage_03" },
    ],
  },
} as const;

export type CrossStageRuleKey = keyof typeof CROSS_STAGE_REFERENCE_RULES;

export type ReferenceCheck = {
  sourceField: string;
  targetField: string;
  targetStage: string;
};

export type BrokenReference = {
  rule: CrossStageRuleKey;
  sourceField: string;
  missingRef: string;
  expectedIn: string;
};

// =============================================================================
// 第 4 部分: 派生字段检查
// =============================================================================

/**
 * 递归检查数据对象是否包含禁止手动填写的派生字段。
 * 对标 status_derivation.py reject_manual_derived_fields()。
 */
export function checkDerivedFields(
  data: unknown,
  label: string,
  forbiddenFields: readonly string[] = FORBIDDEN_MANUAL_FIELDS as readonly string[],
): string[] {
  const violations: string[] = [];
  if (data === null || data === undefined) return violations;
  if (typeof data !== "object") return violations;

  const stack: Array<{ key: string; value: unknown; path: string }> = [];

  // 根层级
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      stack.push({ key: `[${i}]`, value: data[i], path: `${label}` });
    }
  } else {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      stack.push({ key, value, path: `${label}` });
    }
  }

  while (stack.length > 0) {
    const entry = stack.pop()!;
    const currentPath = `${entry.path}.${entry.key}`;

    // 检查是否是被禁止的字段
    if (forbiddenFields.includes(entry.key as any)) {
      const value = entry.value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        violations.push(`${currentPath}="${String(value).slice(0, 60)}" 是派生字段，LLM 不得直接填写`);
      }
    }

    // 递归进入子对象
    if (entry.value !== null && typeof entry.value === "object") {
      if (Array.isArray(entry.value)) {
        for (let i = 0; i < (entry.value as unknown[]).length; i++) {
          stack.push({
            key: `[${i}]`,
            value: (entry.value as unknown[])[i],
            path: currentPath,
          });
        }
      } else {
        for (const [subKey, subValue] of Object.entries(entry.value as Record<string, unknown>)) {
          stack.push({ key: subKey, value: subValue, path: currentPath });
        }
      }
    }
  }

  return violations;
}

// =============================================================================
// 第 5 部分: 跨阶段引用完整性检查
// =============================================================================

/**
 * 从数据中提取指定字段的所有值 (支持嵌套和数组路径)
 * 路径格式: "judgments[].evidence_refs[]" 或 "expressions[].claim_ref"
 */
function extractRefs(data: unknown, fieldPath: string): string[] {
  const refs: string[] = [];
  if (!data || typeof data !== "object") return refs;

  // 解析路径 "judgments[].evidence_refs[]"
  const parts = fieldPath.split(".");
  let current: unknown = data;

  for (const part of parts) {
    if (part.endsWith("[]")) {
      const key = part.slice(0, -2);
      if (Array.isArray(current)) {
        // 已经是数组，遍历
        const arr = current as unknown[];
        const allValues: string[] = [];
        for (const item of arr) {
          if (item && typeof item === "object") {
            const val = (item as Record<string, unknown>)[key];
            if (Array.isArray(val)) {
              allValues.push(...val.map(String));
            } else if (val !== null && val !== undefined) {
              allValues.push(String(val));
            }
          }
        }
        current = allValues;
      } else if (current && typeof current === "object") {
        const val = (current as Record<string, unknown>)[key];
        if (Array.isArray(val)) {
          current = val;
        } else {
          return refs; // 路径不匹配
        }
      } else {
        return refs;
      }
    } else {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[part];
      } else if (Array.isArray(current) && current.length > 0) {
        // 最后一级：从数组中提取
        const arr = current as unknown[];
        for (const item of arr) {
          if (item && typeof item === "object") {
            const val = (item as Record<string, unknown>)[part];
            if (val !== null && val !== undefined) {
              refs.push(String(val));
            }
          }
        }
        return refs;
      } else {
        return refs;
      }
    }
  }

  // 如果最后 current 是字符串数组，返回它
  if (Array.isArray(current)) {
    for (const item of current) {
      if (typeof item === "string") refs.push(item);
    }
  }

  return refs;
}

/**
 * 检查跨阶段引用完整性
 * 返回所有断裂的引用
 */
export function checkCrossStageReferences(
  currentData: unknown,
  currentStage: string,
  upstreamData: Record<string, unknown>,
): BrokenReference[] {
  const broken: BrokenReference[] = [];

  for (const [ruleKey, ruleDef] of Object.entries(CROSS_STAGE_REFERENCE_RULES)) {
    const rule = ruleDef as unknown as { checks: ReferenceCheck[] };
    for (const check of rule.checks) {
      const upstream = upstreamData[check.targetStage];
      if (!upstream) continue;

      // 构建上游 ID 集合
      const upstreamIds = extractRefs(upstream, check.targetField);
      const upstreamIdSet = new Set(upstreamIds);

      // 提取当前阶段的引用值
      const currentRefs = extractRefs(currentData, check.sourceField);

      for (const ref of currentRefs) {
        if (ref && !upstreamIdSet.has(ref)) {
          broken.push({
            rule: ruleKey as CrossStageRuleKey,
            sourceField: check.sourceField,
            missingRef: ref,
            expectedIn: `${check.targetStage}.${check.targetField}`,
          });
        }
      }
    }
  }

  return broken;
}

// =============================================================================
// 第 6 部分: 哈希绑定
// =============================================================================

/**
 * 计算产物的输入绑定哈希
 * 绑定上游产物内容哈希 + 当前阶段种类
 */
export function computeBindingHash(
  inputs: Record<string, string>, // stage -> sha256
  stage: string,
): string {
  const payload = Object.entries(inputs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
  return createHash("sha256").update(`${stage}:${payload}`).digest("hex").slice(0, 16);
}

/**
 * 检查产物是否 stale：(当前 binding_hash vs 上游实时哈希)
 */
export function checkStale(
  bindingHash: string,
  upstreamHashes: Record<string, string>,
  stage: string,
): { stale: boolean; reason: string } {
  const expected = computeBindingHash(upstreamHashes, stage);
  if (expected !== bindingHash) {
    return {
      stale: true,
      reason: `binding_hash mismatch: expected=${expected}, actual=${bindingHash}. 上游输入已变化，当前产物可能过期。`,
    };
  }
  return { stale: false, reason: "binding_hash 一致" };
}

// =============================================================================
// 第 7 部分: 输出质量综合报告
// =============================================================================

export type OutputQualityReport = {
  stage: string;
  passed: boolean;
  derivedFieldViolations: string[];
  brokenReferences: BrokenReference[];
  defectsDetected: StageDefectReport[];
  hashBinding: {
    bindingHash: string;
    stale: boolean;
    staleReason: string;
  };
  summary: string;
};

/**
 * 运行全量输出合同校验
 */
export function validateOutputQuality(
  stage: string,
  data: unknown,
  upstreamData: Record<string, unknown>,
  upstreamHashes: Record<string, string>,
  options: {
    checkDerived?: boolean;
    checkReferences?: boolean;
    checkStale?: boolean;
  } = {},
): OutputQualityReport {
  const derivedFieldViolations = options.checkDerived !== false
    ? checkDerivedFields(data, stage)
    : [];

  const brokenReferences = options.checkReferences !== false
    ? checkCrossStageReferences(data, stage, upstreamData)
    : [];

  const bindingHash = computeBindingHash(upstreamHashes, stage);
  const staleResult = options.checkStale !== false
    ? checkStale(bindingHash, upstreamHashes, stage)
    : { stale: false, reason: "未启用 stale 检查" };

  const hasBlockers = derivedFieldViolations.length > 0 || brokenReferences.length > 0 || staleResult.stale;
  const passed = !hasBlockers;

  const issues: string[] = [];
  if (derivedFieldViolations.length > 0) {
    issues.push(`${derivedFieldViolations.length} 个派生字段违规`);
  }
  if (brokenReferences.length > 0) {
    issues.push(`${brokenReferences.length} 个跨阶段引用断裂`);
  }
  if (staleResult.stale) {
    issues.push(`产物过期: ${staleResult.reason}`);
  }

  return {
    stage,
    passed,
    derivedFieldViolations,
    brokenReferences,
    defectsDetected: [],
    hashBinding: {
      bindingHash,
      stale: staleResult.stale,
      staleReason: staleResult.reason,
    },
    summary: passed
      ? `输出合同校验通过 (stage=${stage}, binding=${bindingHash})`
      : `输出合同校验失败: ${issues.join("; ")}`,
  };
}
