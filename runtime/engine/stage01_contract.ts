/** Stage01 规范字段默认值、澄清合同与确认门禁。 */

import {
  applyHighQualityGate,
  bodyMeetsMinDensity,
  downgradeIfHighQualityFails,
  looksLikePlaceholder,
  nonEmptyText,
  requireDeterministicChecked,
  type StageQualityIssue,
} from "./stage_high_quality";

export const STAGE01_QUALITY_GATE_REF =
  "workflow/stages/01_受理/01_投研判断任务受理与整理规范.md#5-质量门槛与返工";

export type TaskDisposition =
  | "accepted"
  | "needs_clarification"
  | "out_of_scope"
  | "split_required";

export type QualityStatus =
  | "draft"
  | "minimum_pass"
  | "high_quality_pass"
  | "return_required"
  | "stop_with_gap_report";

export type ClarificationItem = {
  question_id: string;
  topic: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
};

export type PremiseRecord = {
  id: string;
  statement: string;
  source_refs: string[];
  invalidation_conditions: string[];
};

/** 澄清主题 → 用户可读标签（仅作次要说明；主文案必须是 question 人话）。 */
export const CLARIFICATION_TOPIC_LABELS: Record<string, string> = {
  core_object: "对象是否拆开",
  object: "对象是否拆开",
  comparison_scope: "比较范围",
  judgment_action: "判断动作",
  judgment_type: "判断类型",
  time_scope: "时间如何落到口径",
  time_window: "时间如何落到口径",
  event_scope_and_time_window: "时间如何落到口径",
  primary_channel: "主分析通道",
  intended_use: "用途与交付",
  delivery_landing: "用途与交付",
  delivery_depth: "用途与交付",
  scope_boundary: "范围边界",
  main_axis: "研究主线",
  structural_ambiguity: "关键歧义",
};

const PLACEHOLDER_CLARIFICATION_QUESTIONS = new Set([
  "",
  "待澄清问题",
  "请回答当前结构性歧义问题",
  "请回答当前结构性歧义问题。",
]);

/** 模板腔 / 系统话术：不是 7/13 那种短人话追问。 */
const TEMPLATE_CLARIFICATION_PATTERN = /当前理解的|请确认本次|请回答当前结构性|结构性歧义|还需要确认「|不同选择会改变后续|UC-\d+|structural_ambiguity|core_object|topic:/i;

function nonEmpty(value: unknown, fallback = ""): string {
  return nonEmptyText(value, fallback);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizePremiseRecords(
  value: unknown,
  options: {
    prefix: "KF" | "UA" | "HV";
    defaultSourceRef: string;
    defaultInvalidationCondition: string;
  },
): PremiseRecord[] {
  if (!Array.isArray(value)) return [];
  const seenStatements = new Set<string>();
  const records: PremiseRecord[] = [];
  for (const item of value) {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const statement = nonEmpty(
      typeof item === "string" ? item : source.statement ?? source.content ?? source.hypothesis,
    );
    const statementKey = statement.replace(/\s+/g, "").replace(/[？?。；;]+$/g, "");
    if (!statement || seenStatements.has(statementKey)) continue;
    seenStatements.add(statementKey);
    const sourceRefs = stringList(source.source_refs).length
      ? stringList(source.source_refs)
      : [options.defaultSourceRef];
    const invalidationConditions = stringList(source.invalidation_conditions).length
      ? stringList(source.invalidation_conditions)
      : stringList(source.rollback_triggers).length
        ? stringList(source.rollback_triggers)
        : [options.defaultInvalidationCondition];
    records.push({
      id: nonEmpty(source.id, `${options.prefix}-${String(records.length + 1).padStart(2, "0")}`),
      statement,
      source_refs: sourceRefs,
      invalidation_conditions: invalidationConditions,
    });
  }
  return records;
}

function clipOriginal(value: unknown, max = 36): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function clarificationTopicLabel(topic: unknown): string {
  const key = String(topic || "").trim();
  if (!key) return "关键歧义";
  return CLARIFICATION_TOPIC_LABELS[key] || (/[\u4e00-\u9fff]/.test(key) ? key : "关键歧义");
}

/** 追问会改变什么（给 UI 第二行，不代替 question）。 */
export function clarificationImpactHint(topic: unknown): string {
  const key = String(topic || "").trim();
  switch (key) {
    case "core_object":
    case "object":
    case "comparison_scope":
      return "这个选择会决定后续按整体建结构，还是拆开比较。";
    case "time_scope":
    case "time_window":
    case "event_scope_and_time_window":
      return "这个选择会决定取数截止时点，以及结论能否写成条件式时间窗口。";
    case "delivery_landing":
    case "intended_use":
    case "delivery_depth":
      return "这个选择会决定交付写成行业/主题判断，还是个股建议口径。";
    case "judgment_action":
    case "judgment_type":
      return "这个选择会决定后续判断单元类型与证据要求。";
    case "primary_channel":
      return "这个选择会决定主证据通道与竞争解释方向。";
    default:
      return "这个选择会改变后续研究结构，需要先定下来。";
  }
}

export function isHumanClarificationQuestion(question: unknown): boolean {
  const text = String(question || "").trim();
  if (!text || text.length < 8 || text.length > 80) return false;
  if (PLACEHOLDER_CLARIFICATION_QUESTIONS.has(text)) return false;
  if (TEMPLATE_CLARIFICATION_PATTERN.test(text)) return false;
  if (!/[\u4e00-\u9fff]/.test(text)) return false;
  return true;
}

/** 从主题 / 原问题 / 系统理解合成一句短人话追问（模型漏写时兜底；气质对齐 7/13）。 */
export function synthesizeClarificationQuestion(input: {
  topic?: unknown;
  unresolved?: unknown;
  original_input?: unknown;
  understanding?: {
    core_object?: unknown;
    judgment_action?: unknown;
    time_window?: unknown;
    scope_boundary?: unknown;
    delivery_landing?: unknown;
  };
}): string {
  const topic = String(input.topic || "").trim() || "structural_ambiguity";
  const unresolved = stringList(input.unresolved);
  const firstUnresolved = unresolved[0] || "";
  const effectiveTopic = topic === "structural_ambiguity" && firstUnresolved ? firstUnresolved : topic;
  const object = nonEmpty(input.understanding?.core_object);
  const original = clipOriginal(input.original_input, 28);
  const objectClip = clipOriginal(object, 24);

  switch (effectiveTopic) {
    case "core_object":
    case "object":
    case "comparison_scope":
      if (objectClip) return `是否把 ${objectClip} 拆开判断，还是按整体判断？`;
      if (original) return `「${original}」里的对象要拆开判断，还是按整体判断？`;
      return "研究对象要拆开判断，还是按整体判断？";
    case "judgment_action":
    case "judgment_type":
      if (original) return `「${original}」要做状态/阶段判断，还是影响或路径判断？`;
      return "本次要做状态/阶段判断，还是影响或路径判断？";
    case "time_scope":
    case "time_window":
    case "event_scope_and_time_window":
      return "「当前」和周期「结束」如何落到时间范围？";
    case "primary_channel":
      return "本次主通道优先看供需价格，还是政策/业绩传导？";
    case "intended_use":
    case "delivery_landing":
    case "delivery_depth":
      return "是否输出行业/主题判断并排除个股投资建议？";
    case "scope_boundary":
    case "main_axis":
      if (original) return `「${original}」本次只追哪一条主线，明确不覆盖什么？`;
      return "本次只追哪一条主线，明确不覆盖什么？";
    default:
      if (/[\u4e00-\u9fff]/.test(firstUnresolved)) return firstUnresolved;
      if (original) return `「${original}」里还有哪一点需要先定下来？`;
      return "还有哪一点需要先定下来，才能开始研究？";
  }
}

function isPlaceholderClarificationQuestion(question: unknown): boolean {
  return !isHumanClarificationQuestion(question);
}

function normalizeClarificationItem(
  item: any,
  index: number,
  context: {
    unresolved: string[];
    understanding: Record<string, unknown>;
    original_input: string;
  },
): ClarificationItem {
  const topicRaw = nonEmpty(item?.topic, context.unresolved[0] || "structural_ambiguity");
  const topic = topicRaw === "structural_ambiguity" && context.unresolved[0]
    ? context.unresolved[0]
    : topicRaw;
  const rawQuestion = item?.question;
  const question = isPlaceholderClarificationQuestion(rawQuestion)
    ? synthesizeClarificationQuestion({
      topic,
      unresolved: context.unresolved,
      understanding: context.understanding,
      original_input: context.original_input,
    })
    : String(rawQuestion).trim();
  return {
    question_id: nonEmpty(item?.question_id, `UC-${String(index + 1).padStart(2, "0")}`),
    topic,
    question,
    answer: item?.answer == null || String(item.answer).trim() === "" ? null : String(item.answer),
    answered_at: item?.answered_at == null || String(item.answered_at).trim() === ""
      ? null
      : String(item.answered_at),
  };
}

/** 为受控表单 / 旧产物补齐规范 frontmatter 字段，再交给 Zod。原地写入并返回同一对象。 */
export function ensureStage01ContractFields(data: any, question: string): any {
  const next = data && typeof data === "object" ? data : {};
  const previousResolution = next.input_resolution && typeof next.input_resolution === "object"
    ? next.input_resolution
    : {};
  const unresolved = stringList(previousResolution.unresolved_structural_ambiguities);
  const understandingSeed = previousResolution.system_understanding && typeof previousResolution.system_understanding === "object"
    ? previousResolution.system_understanding
    : {};
  let clarifications: ClarificationItem[] = Array.isArray(previousResolution.clarifications)
    ? previousResolution.clarifications.map((item: any, index: number) => normalizeClarificationItem(item, index, {
      unresolved,
      understanding: understandingSeed,
      original_input: nonEmpty(next.original_input, question),
    }))
    : [];
  // 未决主题若尚未登记追问，一次补齐（最多 5 条），避免只问到一半
  {
    const coveredTopics = new Set(clarifications.map((item) => item.topic));
    const missing = unresolved
      .filter((topic) => !coveredTopics.has(topic))
      .slice(0, Math.max(0, 5 - clarifications.length));
    if (missing.length) {
      clarifications = [
        ...clarifications,
        ...missing.map((topic, offset) => normalizeClarificationItem({
          question_id: `UC-${String(clarifications.length + offset + 1).padStart(2, "0")}`,
          topic,
          question: "",
          answer: null,
          answered_at: null,
        }, clarifications.length + offset, {
          unresolved,
          understanding: understandingSeed,
          original_input: nonEmpty(next.original_input, question),
        })),
      ];
    }
  }
  let unanswered = clarifications.filter((item) => !item.answer);
  let disposition = (nonEmpty(next.task_disposition, unanswered.length || unresolved.length
    ? "needs_clarification"
    : "accepted") as TaskDisposition);

  // 模型标了 needs_clarification 却未登记任何追问/未决：按 7/13 默认结构一次补齐三题
  if (disposition === "needs_clarification" && !unanswered.length && !unresolved.length) {
    const defaultTopics = ["core_object", "event_scope_and_time_window", "delivery_landing"];
    const coveredTopics = new Set(clarifications.map((item) => item.topic));
    const toAdd = defaultTopics
      .filter((topic) => !coveredTopics.has(topic))
      .slice(0, Math.max(0, 5 - clarifications.length));
    if (toAdd.length) {
      clarifications = [
        ...clarifications,
        ...toAdd.map((topic, offset) => normalizeClarificationItem({
          question_id: `UC-${String(clarifications.length + offset + 1).padStart(2, "0")}`,
          topic,
          question: "",
          answer: null,
          answered_at: null,
        }, clarifications.length + offset, {
          unresolved: toAdd,
          understanding: understandingSeed,
          original_input: nonEmpty(next.original_input, question),
        })),
      ];
      unanswered = clarifications.filter((item) => !item.answer);
      previousResolution.unresolved_structural_ambiguities = toAdd;
    } else {
      // 已有澄清且都答完：视为待重生成的中间态，不降成 accepted（避免误确认）
      disposition = clarifications.every((item) => Boolean(item.answer))
        ? "needs_clarification"
        : "accepted";
    }
  }
  const unresolvedFinal = stringList(
    previousResolution.unresolved_structural_ambiguities?.length
      ? previousResolution.unresolved_structural_ambiguities
      : unresolved,
  );
  const understanding = understandingSeed;

  next.stage_status = nonEmpty(next.stage_status, disposition === "accepted" ? "complete" : "in_progress");
  next.task_disposition = disposition;
  next.status_reason = nonEmpty(
    next.status_reason,
    disposition === "accepted"
      ? "核心对象、比较范围、时间三件套、用途与交付深度已解析，可进入 02。"
      : "存在结构性歧义，需先完成澄清后再正式受理。",
  );
  next.quality_status = nonEmpty(next.quality_status, disposition === "accepted" ? "minimum_pass" : "draft") as QualityStatus;
  next.quality_gate_ref = nonEmpty(next.quality_gate_ref, STAGE01_QUALITY_GATE_REF);
  next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  next.semantic_review_status = nonEmpty(next.semantic_review_status, "not_reviewed");
  next.return_required = Boolean(next.return_required);
  next.return_stage = next.return_stage == null || next.return_stage === "" ? null : String(next.return_stage);
  next.original_input = nonEmpty(next.original_input, question);
  next.judgment_landing = nonEmpty(next.judgment_landing, nonEmpty(next.judgment_action, "状态与趋势判断"));
  next.task_type = next.task_type && typeof next.task_type === "object"
    ? {
      primary: nonEmpty(next.task_type.primary, "状态与趋势判断"),
      secondary: stringList(next.task_type.secondary),
    }
    : { primary: "状态与趋势判断", secondary: [] };
  next.delivery_archetype = next.delivery_archetype && typeof next.delivery_archetype === "object"
    ? {
      primary: nonEmpty(next.delivery_archetype.primary, "industry_cycle_report"),
      secondary: stringList(next.delivery_archetype.secondary),
      modules: stringList(next.delivery_archetype.modules),
    }
    : { primary: "industry_cycle_report", secondary: [], modules: [] };
  next.intended_use = stringList(next.intended_use).length ? stringList(next.intended_use) : ["internal_research"];
  next.not_allowed_use = stringList(next.not_allowed_use).length
    ? stringList(next.not_allowed_use)
    : ["external_published_report", "trading_recommendation"];
  next.main_judgment_axis = next.main_judgment_axis && typeof next.main_judgment_axis === "object"
    ? {
      object: nonEmpty(next.main_judgment_axis.object, next.core_object),
      comparison_scope: nonEmpty(next.main_judgment_axis.comparison_scope, "无比较"),
      judgment_action: nonEmpty(next.main_judgment_axis.judgment_action, next.judgment_action),
      primary_channel: nonEmpty(next.main_judgment_axis.primary_channel, "待在 02 固化主通道"),
      key_question: nonEmpty(next.main_judgment_axis.key_question, next.normalized_question),
      expected_05_landing: nonEmpty(next.main_judgment_axis.expected_05_landing, "形成可验证方向判断并交代边界"),
      non_core_axes: stringList(next.main_judgment_axis.non_core_axes),
    }
    : {
      object: nonEmpty(next.core_object),
      comparison_scope: "无比较",
      judgment_action: nonEmpty(next.judgment_action),
      primary_channel: "待在 02 固化主通道",
      key_question: nonEmpty(next.normalized_question, question),
      expected_05_landing: "形成可验证方向判断并交代边界",
      non_core_axes: [],
    };
  next.delivery_depth = next.delivery_depth && typeof next.delivery_depth === "object"
    ? {
      conclusion_granularity: nonEmpty(next.delivery_depth.conclusion_granularity, "方向判断 + 可验证信号"),
      minimum_delivery: nonEmpty(next.delivery_depth.minimum_delivery, "方向判断、关键信号与失效条件"),
    }
    : {
      conclusion_granularity: "方向判断 + 可验证信号",
      minimum_delivery: "方向判断、关键信号与失效条件",
    };
  next.research_value_gate = next.research_value_gate && typeof next.research_value_gate === "object"
    ? {
      status: nonEmpty(next.research_value_gate.status, disposition === "accepted" ? "pass" : "pending"),
      value_level: nonEmpty(next.research_value_gate.value_level, "medium"),
      disagreement_or_unknown: nonEmpty(next.research_value_gate.disagreement_or_unknown, "待识别市场分歧或关键未知"),
      changing_variable: nonEmpty(next.research_value_gate.changing_variable, "待识别正在变化的决定性变量"),
      asset_or_decision_impact_path: nonEmpty(next.research_value_gate.asset_or_decision_impact_path, "支持行业跟踪与假设更新"),
      decision_use: nonEmpty(next.research_value_gate.decision_use, "内部投研判断"),
      why_now: nonEmpty(next.research_value_gate.why_now, "当前窗口需要对齐判断边界"),
      incremental_question: nonEmpty(next.research_value_gate.incremental_question, nonEmpty(next.normalized_question, question)),
      low_value_reason: next.research_value_gate.low_value_reason == null
        ? ""
        : String(next.research_value_gate.low_value_reason),
    }
    : {
      status: disposition === "accepted" ? "pass" : "pending",
      value_level: "medium",
      disagreement_or_unknown: "待识别市场分歧或关键未知",
      changing_variable: "待识别正在变化的决定性变量",
      asset_or_decision_impact_path: "支持行业跟踪与假设更新",
      decision_use: "内部投研判断",
      why_now: "当前窗口需要对齐判断边界",
      incremental_question: nonEmpty(next.normalized_question, question),
      low_value_reason: "",
    };
  next.overscope_check = next.overscope_check && typeof next.overscope_check === "object"
    ? {
      status: nonEmpty(next.overscope_check.status, disposition === "accepted" ? "pass" : "pending"),
      reason: nonEmpty(next.overscope_check.reason, "范围是否已收敛待确认"),
      broadness_flags: stringList(next.overscope_check.broadness_flags),
      alternative_subquestions: stringList(next.overscope_check.alternative_subquestions),
      excluded_paths: stringList(next.overscope_check.excluded_paths).length
        ? stringList(next.overscope_check.excluded_paths)
        : stringList(next.exclusions),
      allowed_secondary_axes: stringList(next.overscope_check.allowed_secondary_axes),
    }
    : {
      status: disposition === "accepted" ? "pass" : "pending",
      reason: "范围是否已收敛待确认",
      broadness_flags: [],
      alternative_subquestions: [],
      excluded_paths: stringList(next.exclusions),
      allowed_secondary_axes: [],
    };
  next.needs_split = Boolean(next.needs_split);
  next.split_recommendation = next.split_recommendation == null ? null : String(next.split_recommendation);
  next.scope_summary = nonEmpty(
    next.scope_summary,
    [
      nonEmpty(next.core_object),
      nonEmpty(next.judgment_action),
      nonEmpty(next.time_scope?.as_of),
    ].filter(Boolean).join("；"),
  );
  next.known_facts = normalizePremiseRecords(next.known_facts, {
    prefix: "KF",
    defaultSourceRef: "current_user_input",
    defaultInvalidationCondition: "用户更正原始输入或有效继承上下文发生变化",
  });
  next.user_assumptions = normalizePremiseRecords(next.user_assumptions, {
    prefix: "UA",
    defaultSourceRef: "current_user_input",
    defaultInvalidationCondition: "用户撤回或改写该立场或边界选择",
  });
  next.hypotheses_to_verify = normalizePremiseRecords(next.hypotheses_to_verify, {
    prefix: "HV",
    defaultSourceRef: "system_normalization",
    defaultInvalidationCondition: "后续证据反证该命题或研究问题被重新拆分",
  });
  if (disposition === "accepted" && !next.hypotheses_to_verify.length) {
    next.hypotheses_to_verify = [{
      id: "HV-01",
      statement: `需要验证：${nonEmpty(next.normalized_question, question)}`,
      source_refs: ["system_normalization"],
      invalidation_conditions: ["用户改写规范化研究问题或结构阶段将其拆分为其他命题"],
    }];
  }
  const answeredClarifications = clarifications.filter((item) => item.answer);
  const unresolvedForResolution = unanswered.length
    ? (unresolvedFinal.length ? unresolvedFinal : unanswered.map((item) => item.topic))
    : unresolvedFinal;
  next.input_resolution = {
    mode: nonEmpty(
      previousResolution.mode,
      answeredClarifications.length ? "user_clarified" : "direct_extract",
    ),
    status: nonEmpty(
      previousResolution.status,
      disposition === "accepted" && !unresolvedForResolution.length && !unanswered.length ? "resolved" : "pending",
    ),
    source_refs: stringList(previousResolution.source_refs).length
      ? stringList(previousResolution.source_refs)
      : ["current_user_input"],
    system_understanding: {
      core_object: nonEmpty(understanding.core_object, next.core_object),
      judgment_action: nonEmpty(understanding.judgment_action, next.judgment_action),
      time_window: nonEmpty(
        understanding.time_window,
        [
          nonEmpty(next.time_scope?.lookback),
          nonEmpty(next.time_scope?.as_of),
          nonEmpty(next.time_scope?.forward),
        ].filter(Boolean).join(" / "),
      ),
      scope_boundary: nonEmpty(
        understanding.scope_boundary,
        [...stringList(next.boundaries), ...stringList(next.exclusions).map((item) => `排除：${item}`)].join("；"),
      ),
      delivery_landing: nonEmpty(understanding.delivery_landing, next.delivery_depth?.minimum_delivery),
    },
    rollback_assumptions: stringList(previousResolution.rollback_assumptions),
    clarifications,
    unresolved_structural_ambiguities: unresolvedForResolution,
  };

  // high_quality 形态自检：不过则降档；过则要求 checked。
  if (nonEmpty(next.quality_status) === "high_quality_pass") {
    const provisional = { ...next, deterministic_check_status: "checked" };
    const hqErrors = collectStage01HighQualityIssues(provisional);
    if (hqErrors.length) {
      downgradeIfHighQualityFails(next, hqErrors);
    } else {
      next.deterministic_check_status = "checked";
    }
  }
  return next;
}

export function pendingClarificationQuestion(data: any): ClarificationItem | null {
  const clarifications: ClarificationItem[] = data?.input_resolution?.clarifications || [];
  return clarifications.find((item) => !item.answer) || null;
}

export function pendingClarificationQuestions(data: any): ClarificationItem[] {
  const clarifications: ClarificationItem[] = data?.input_resolution?.clarifications || [];
  return clarifications.filter((item) => !item.answer);
}

export function applyClarificationAnswer(
  data: any,
  answer: string,
  options: { question_id?: string; answered_at?: string } = {},
): any {
  return applyClarificationAnswers(data, [{
    question_id: options.question_id,
    answer,
  }], { answered_at: options.answered_at });
}

export function applyClarificationAnswers(
  data: any,
  answers: Array<{ question_id?: string; answer: string }>,
  options: { answered_at?: string } = {},
): any {
  const next = ensureStage01ContractFields(
    JSON.parse(JSON.stringify(data || {})),
    String(data?.original_input || data?.normalized_question || ""),
  );
  const clarifications: ClarificationItem[] = [...(next.input_resolution.clarifications || [])];
  const pending = clarifications.filter((item) => !item.answer);
  if (!pending.length) throw new Error("当前没有待回答的澄清问题");
  if (!Array.isArray(answers) || !answers.length) throw new Error("澄清回答不能为空");

  const answeredAt = options.answered_at || new Date().toISOString();
  const answeredTopics = new Set<string>();
  let pendingCursor = 0;

  for (const entry of answers) {
    const trimmed = String(entry?.answer || "").trim();
    if (!trimmed) throw new Error("澄清回答不能为空");
    let index = -1;
    if (entry.question_id) {
      index = clarifications.findIndex((item) => item.question_id === entry.question_id);
      if (index < 0) throw new Error(`找不到澄清问题 ${entry.question_id}`);
    } else {
      while (pendingCursor < clarifications.length && clarifications[pendingCursor].answer) {
        pendingCursor += 1;
      }
      index = pendingCursor;
      pendingCursor += 1;
    }
    if (index < 0 || index >= clarifications.length) throw new Error("澄清问题与回答无法对齐");
    if (clarifications[index].answer) {
      throw new Error(`${clarifications[index].question_id} 已有回答，请等待下一轮生成`);
    }
    clarifications[index] = {
      ...clarifications[index],
      answer: trimmed,
      answered_at: answeredAt,
    };
    answeredTopics.add(clarifications[index].topic);
  }

  const stillPending = clarifications.some((item) => !item.answer);
  if (stillPending) {
    throw new Error("请一次答完全部澄清问题后再提交");
  }

  next.input_resolution = {
    ...next.input_resolution,
    mode: "user_clarified",
    status: "pending",
    clarifications,
    unresolved_structural_ambiguities: (next.input_resolution.unresolved_structural_ambiguities || [])
      .filter((item: string) => ![...answeredTopics].some((topic) => item.includes(topic))),
  };
  next.task_disposition = "needs_clarification";
  next.stage_status = "in_progress";
  next.quality_status = "draft";
  return next;
}

/** Stage01 high_quality：边界实质 + 价值门禁非占位 + 正文密度 + deterministic checked。 */
export function collectStage01HighQualityIssues(data: any): StageQualityIssue[] {
  const issues: StageQualityIssue[] = [];
  const gate = data?.research_value_gate || {};
  if (looksLikePlaceholder(gate.disagreement_or_unknown)) {
    issues.push({
      severity: "error",
      code: "value_gate_disagreement_thin",
      message: "high_quality 要求写清分歧或关键未知，不得用占位句",
    });
  }
  if (looksLikePlaceholder(gate.changing_variable)) {
    issues.push({
      severity: "error",
      code: "value_gate_variable_thin",
      message: "high_quality 要求写清正在变化的决定性变量",
    });
  }
  if (looksLikePlaceholder(gate.incremental_question)) {
    issues.push({
      severity: "error",
      code: "value_gate_incremental_thin",
      message: "high_quality 要求写清相对常见叙事的增量问题",
    });
  }
  if (!nonEmpty(data?.delivery_archetype?.primary) && !nonEmpty(data?.delivery_archetype)) {
    issues.push({
      severity: "error",
      code: "delivery_archetype_missing",
      message: "high_quality 要求明确 delivery_archetype.primary",
    });
  }
  if (!bodyMeetsMinDensity(data?.document_markdown, 500)) {
    issues.push({
      severity: "error",
      code: "stage01_body_thin",
      message: "high_quality 要求需求说明正文达到可审阅密度（≥500 字，非短摘要）",
    });
  }
  requireDeterministicChecked(data, issues);
  return issues;
}

/** 确认 Stage01 的规范门禁；失败抛错。 */
export function assertStage01ReadyForApproval(data: any) {
  if (String(data?.task_disposition || "") !== "accepted") {
    throw new Error("Stage01 仅在 task_disposition=accepted 时可确认；请先完成澄清或收窄范围");
  }
  const unresolved = data?.input_resolution?.unresolved_structural_ambiguities || [];
  if (Array.isArray(unresolved) && unresolved.length) {
    throw new Error("仍有未决结构性歧义，不能确认进入 02");
  }
  const pending = pendingClarificationQuestion(data);
  if (pending) {
    throw new Error(`澄清问题 ${pending.question_id} 尚未回答，不能确认`);
  }
  const clarifications = data?.input_resolution?.clarifications || [];
  if (
    String(data?.input_resolution?.mode || "") === "direct_extract"
    && clarifications.some((item: ClarificationItem) => Boolean(item.answer))
  ) {
    throw new Error("direct_extract 不得携带已填写的澄清答案；禁止伪造用户确认");
  }
  if (String(data?.research_value_gate?.status || "") !== "pass") {
    throw new Error("research_value_gate 未通过，不能确认");
  }
  if (String(data?.overscope_check?.status || "") !== "pass") {
    throw new Error("overscope_check 未通过，不能确认");
  }
  if (
    !Array.isArray(data?.known_facts)
    || !Array.isArray(data?.user_assumptions)
    || !Array.isArray(data?.hypotheses_to_verify)
  ) {
    throw new Error("前提三分字段不完整，不能确认");
  }
  if (!data.hypotheses_to_verify.length) {
    throw new Error("尚未形成待验证假设，不能确认进入 02");
  }
  const quality = String(data?.quality_status || "");
  if (quality !== "high_quality_pass") {
    throw new Error("本稿尚未达到可交接密度，请重新生成后再确认");
  }
  // 00A「不偷换问题」：accepted 时须能回答对象/时间/用途边界。
  const timeScope = data?.time_scope || {};
  const researchScope = data?.research_scope || data?.scope || {};
  const hasObject = Boolean(
    nonEmpty(data?.normalized_question)
    || nonEmpty(data?.main_judgment_axis?.primary_object)
    || nonEmpty(data?.core_object)
    || nonEmpty(researchScope?.label)
    || stringList(researchScope?.objects).length,
  );
  const hasTime = Boolean(
    nonEmpty(timeScope?.as_of)
    || nonEmpty(timeScope?.forward_window)
    || nonEmpty(timeScope?.forward)
    || nonEmpty(timeScope?.label),
  );
  const hasUse = Boolean(
    nonEmpty(data?.research_value_gate?.decision_use)
    || nonEmpty(data?.delivery_depth)
    || nonEmpty(data?.delivery_archetype?.primary),
  );
  if (!hasObject || !hasTime || !hasUse) {
    throw new Error("Stage01 边界不完整：须明确研究对象、时间口径与用途，避免下游偷换问题");
  }
  const hqErrors = applyHighQualityGate(collectStage01HighQualityIssues(data), quality)
    .filter((item) => item.severity === "error");
  if (hqErrors.length) {
    throw new Error(`Stage01 高质量门禁未通过：${hqErrors.map((item) => item.message).join("；")}`);
  }
}
