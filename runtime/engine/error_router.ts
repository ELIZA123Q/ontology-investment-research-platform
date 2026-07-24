import "server-only";

/**
 * 错误路由引擎 — 对标 governance/03_校验/validate_publish.py VALIDATOR_ERROR_ROUTES
 *
 * 将校验失败信息通过正则模式匹配自动路由到应退回的阶段，
 * 生成可执行的修复提示（而非 generic "failed"）。
 *
 * 核心概念:
 * - 每个阶段的校验失败都会产生 ErrorContext（错误类型 + 上下文信息）
 * - ErrorRouter 根据预定义的 ErrorRoute 规则匹配错误并生成 ReworkItem
 * - ReworkItem 包含 return_stage（应退回的阶段）、rule_id（规则编号）、fix_hint（修复提示）
 */

export const RETURN_STAGES = ["01", "02", "03", "04", "05"] as const;
export type ReturnStage = (typeof RETURN_STAGES)[number];

// =============================================================================
// 错误路由定义
// =============================================================================

export type ErrorRoute = {
  /** 正则模式，匹配错误消息 */
  pattern: RegExp;
  /** 应退回的阶段 */
  returnTo: ReturnStage;
  /** 规则编号 */
  ruleId: string;
  /** 修复提示（人类可读） */
  fixHint: string;
};

export type ReworkItem = {
  returnTo: ReturnStage;
  ruleId: string;
  message: string;
  fixHint: string;
  /** 受影响的阶段 */
  affectedStage: ReturnStage;
};

/**
 * 完整错误路由表 — 对标 validate_publish.py VALIDATOR_ERROR_ROUTES
 * 每条路由包含: 匹配模式 → 退回阶段 → 规则编号 → 修复提示
 */
export const ERROR_ROUTES: Record<ReturnStage, ErrorRoute[]> = {
  "01": [
    {
      pattern: /研究问题|question|研究范围|scope|overscope|问题不清/,
      returnTo: "01",
      ruleId: "01.validator.clarification",
      fixHint: "明确研究问题、范围、用途和预期输出类型",
    },
  ],
  "02": [
    {
      pattern: /source_document|01\.|投研需求说明|stage_status|研究问题|question/,
      returnTo: "01",
      ruleId: "02.validator.upstream_01",
      fixHint: "先修正 01 需求说明（问题范围/用途/输出类型），再重建 02",
    },
    {
      pattern: /judgment_spine|minimum_question_tree|state_variable_chain|核心命题|问题树/,
      returnTo: "02",
      ruleId: "02.validator.structure",
      fixHint: "补齐核心待验证命题、问题树、路径或状态变量链",
    },
    {
      pattern: /handoff_to_03|evidence_requirements|instance_requirements|证据需求/,
      returnTo: "02",
      ruleId: "02.validator.handoff",
      fixHint: "补齐 03 可执行的实例与证据需求",
    },
    {
      pattern: /派生字段|derived_field|maximum_judgment_level|evidence_permission|publishable/,
      returnTo: "02",
      ruleId: "02.validator.derived_field",
      fixHint: "删除 LLM 手动填写的派生字段（maximum_judgment_level/evidence_permission/publishable），这些由确定性规则计算",
    },
    {
      pattern: /引用断裂|引用不存在|broken_reference|missing.*ref/,
      returnTo: "02",
      ruleId: "02.validator.reference",
      fixHint: "修复跨阶段引用断裂，确保所有 ref 能追溯到上游产物",
    },
  ],
  "03": [
    {
      pattern: /source_02|logic_id|view_id|研究逻辑|本体视图|02_/,
      returnTo: "02",
      ruleId: "03.validator.upstream_02",
      fixHint: "02 结构或引用断裂，退回重建判断结构",
    },
    {
      pattern: /judgment_unit|path_readiness|state_variable|evidence_requirements/,
      returnTo: "02",
      ruleId: "03.validator.structure",
      fixHint: "判断单元/路径/状态变量与 02 不一致",
    },
    {
      pattern: /反证|counter_check|conflict_status|counterevidence/,
      returnTo: "03",
      ruleId: "03.validator.counter_evidence",
      fixHint: "补反证检查或处理证据冲突",
    },
    {
      pattern: /口径|source_tier|proxy|证据角色|证据质量|evidence_quality/,
      returnTo: "03",
      ruleId: "03.validator.evidence_quality",
      fixHint: "补证据、修口径或降级准入",
    },
    {
      pattern: /来源组|source_group|来源多样性|单来源/,
      returnTo: "03",
      ruleId: "03.validator.source_diversity",
      fixHint: "增加来源组多样性，避免单来源支撑判断",
    },
    {
      pattern: /证据不足|证据缺失|no_evidence|empty_evidence/,
      returnTo: "03",
      ruleId: "03.validator.insufficient",
      fixHint: "至少 1 条证据/JU，考虑使用 MCP 数据源或公开检索补充",
    },
  ],
  "04": [
    {
      pattern: /超过.*03.*判断上限|超过.*矩阵|evidence_readiness|等级越级|判断上限/,
      returnTo: "03",
      ruleId: "04.validator.evidence_ceiling",
      fixHint: "观点超过统一矩阵计算的判断上限（Q×反证×path_readiness），退回 03 补证据或降低 J 等级",
    },
    {
      pattern: /claim_register|overreach_check|claims_within_03|表达许可/,
      returnTo: "03",
      ruleId: "04.validator.claim_overreach",
      fixHint: "退回 03 调整 evidence_readiness 或降低观点强度",
    },
    {
      pattern: /path_results|state_variable_results|ontology_context|judgment_unit/,
      returnTo: "02",
      ruleId: "04.validator.structure",
      fixHint: "核心待验证命题、路径或本体承接不足，退回 02",
    },
    {
      pattern: /source_01|scope|研究范围|问题偷换|overscope/,
      returnTo: "01",
      ruleId: "04.validator.scope",
      fixHint: "研究问题、用途或范围在 04 阶段偏离 01 定义，退回 01 确认",
    },
    {
      pattern: /handoff_to_05|brief_quality_check|表达许可|answer_first/,
      returnTo: "04",
      ruleId: "04.validator.expression",
      fixHint: "在 04 重写判断简报或表达许可，不放大判断",
    },
    {
      pattern: /规则执行|rule_evaluation|确定性规则|deterministic_rule/,
      returnTo: "04",
      ruleId: "04.validator.rules",
      fixHint: "9 项确定性规则未全部通过，检查 rule_evaluation 结果",
    },
  ],
  "05": [
    {
      pattern: /图表|表格|数据密度|display_data|chart_data|table_material|05_material/,
      returnTo: "03",
      ruleId: "05.validator.material_data",
      fixHint: "05 图表数据不足，退回 03 补 display/chart/table 素材",
    },
    {
      pattern: /handoff|approved_core_claims|expression_strength|core_thesis|预期差|object_strength|claim/,
      returnTo: "04",
      ruleId: "05.validator.handoff",
      fixHint: "05 表达超过 04 审计边界，回退 04 调整 handoff/claim",
    },
    {
      pattern: /delivery_archetype|输出原型|报告类型|target_05_archetype|01/,
      returnTo: "01",
      ruleId: "05.validator.archetype",
      fixHint: "报告类型与 01 不一致，退回 01 确认",
    },
    {
      pattern: /引用不存在|figure_id|table_id|data_candidate/,
      returnTo: "03",
      ruleId: "05.validator.missing_data_ref",
      fixHint: "05 引用的数据候选在 03 快照中不存在",
    },
    {
      pattern: /限制性表达|正文不得|标题应是|表达审计|expression_audit/,
      returnTo: "05",
      ruleId: "05.validator.expression",
      fixHint: "在 05 重写正文表达，不新增判断、不越权措辞",
    },
    {
      pattern: /审计腔|audit_voice|机器字段|内部术语|forbidden.*term/,
      returnTo: "05",
      ruleId: "05.validator.voice",
      fixHint: "清理正文中的审计腔、机器字段和内部术语",
    },
    {
      pattern: /固定节|固定章节|fixed_section|论点章|argument_chapter/,
      returnTo: "05",
      ruleId: "05.validator.structure",
      fixHint: "确保 05 包含完整固定节（投资要点/核心结论/Research Edge/投资含义/催化与验证/资料来源）",
    },
    // 新增: 派生字段 + 引用完整性 路由
    {
      pattern: /派生字段|derived_field|maximum_judgment_level|evidence_permission/,
      returnTo: "05",
      ruleId: "05.validator.derived_field",
      fixHint: "删除正文中手写的派生字段标注（J 等级/evidence_permission 等），这些不应出现在研究报告中",
    },
  ],
};

// =============================================================================
// 默认修复提示
// =============================================================================

export const DEFAULT_FIX_HINTS: Record<ReturnStage, string> = {
  "01": "修正需求说明（研究问题/范围/用途/输出类型）后重新校验",
  "02": "修正研究逻辑与本体视图（命题/路径/变量链）后重新校验",
  "03": "补证据、修口径或更新准入后重新冻结快照",
  "04": "在证据边界内重写判断简报与推理审计",
  "05": "按 04 handoff 重写研报正文，不新增判断、不越权措辞",
};

// =============================================================================
// 路由引擎
// =============================================================================

export type ErrorContext = {
  /** 当前阶段 */
  stage: ReturnStage;
  /** 错误/警告消息 */
  message: string;
  /** 额外上下文 */
  context?: string;
};

/**
 * 对单条错误执行路由匹配
 * 返回最匹配的 ReworkItem，无匹配时使用默认提示
 */
export function routeError(
  currentStage: ReturnStage,
  message: string,
  context?: string,
): ReworkItem {
  const routes = ERROR_ROUTES[currentStage] || [];
  const fullMessage = `${message} ${context || ""}`.toLowerCase();

  // 按定义顺序匹配 (先定义 = 高优先级)
  for (const route of routes) {
    if (route.pattern.test(fullMessage)) {
      return {
        returnTo: route.returnTo,
        ruleId: route.ruleId,
        message,
        fixHint: route.fixHint,
        affectedStage: currentStage,
      };
    }
  }

  // 无匹配: 返回当前阶段的默认提示
  return {
    returnTo: currentStage,
    ruleId: `${currentStage}.validator.unknown`,
    message,
    fixHint: DEFAULT_FIX_HINTS[currentStage],
    affectedStage: currentStage,
  };
}

/**
 * 批量路由 — 对所有错误执行路由匹配
 */
export function routeErrors(
  currentStage: ReturnStage,
  errors: ErrorContext[],
): ReworkItem[] {
  return errors.map((err) => routeError(currentStage, err.message, err.context));
}

/**
 * 生成结构化返工报告
 */
export type ReworkReport = {
  currentStage: ReturnStage;
  totalErrors: number;
  reworkItems: ReworkItem[];
  /** 按退回阶段分组 */
  byStage: Record<ReturnStage, ReworkItem[]>;
  /** 是否需要阻断 (有任何不退回当前阶段的 rework 项) */
  shouldBlock: boolean;
  summary: string;
};

export function buildReworkReport(
  currentStage: ReturnStage,
  errors: ErrorContext[],
): ReworkReport {
  const items = routeErrors(currentStage, errors);
  const byStage: Record<ReturnStage, ReworkItem[]> = {
    "01": [],
    "02": [],
    "03": [],
    "04": [],
    "05": [],
  };

  for (const item of items) {
    byStage[item.returnTo].push(item);
  }

  const shouldBlock = items.some((item) => item.returnTo !== currentStage);

  const stageSummary = Object.entries(byStage)
    .filter(([, list]) => list.length > 0)
    .map(([stage, list]) => `退回 ${stage}: ${list.length} 项 (${list.map((item) => item.ruleId).join(", ")})`)
    .join("; ");

  return {
    currentStage,
    totalErrors: errors.length,
    reworkItems: items,
    byStage,
    shouldBlock,
    summary: shouldBlock
      ? `需要返工: ${stageSummary}`
      : `${errors.length} 个问题可在当前阶段修复`,
  };
}
