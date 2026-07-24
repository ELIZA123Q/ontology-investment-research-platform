/** Stage01 规范字段默认值、澄清合同与确认门禁。 */

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

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

/** 为受控表单 / 旧产物补齐规范 frontmatter 字段，再交给 Zod。原地写入并返回同一对象。 */
export function ensureStage01ContractFields(data: any, question: string): any {
  const next = data && typeof data === "object" ? data : {};
  const previousResolution = next.input_resolution && typeof next.input_resolution === "object"
    ? next.input_resolution
    : {};
  const clarifications: ClarificationItem[] = Array.isArray(previousResolution.clarifications)
    ? previousResolution.clarifications.map((item: any, index: number) => ({
      question_id: nonEmpty(item?.question_id, `UC-${String(index + 1).padStart(2, "0")}`),
      topic: nonEmpty(item?.topic, "structural_ambiguity"),
      question: nonEmpty(item?.question, "待澄清问题"),
      answer: item?.answer == null || String(item.answer).trim() === "" ? null : String(item.answer),
      answered_at: item?.answered_at == null || String(item.answered_at).trim() === ""
        ? null
        : String(item.answered_at),
    }))
    : [];
  const unanswered = clarifications.filter((item) => !item.answer);
  const unresolved = stringList(previousResolution.unresolved_structural_ambiguities);
  const disposition = (nonEmpty(next.task_disposition, unanswered.length || unresolved.length
    ? "needs_clarification"
    : "accepted") as TaskDisposition);
  const understanding = previousResolution.system_understanding && typeof previousResolution.system_understanding === "object"
    ? previousResolution.system_understanding
    : {};

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
  const answeredClarifications = clarifications.filter((item) => item.answer);
  next.input_resolution = {
    mode: nonEmpty(
      previousResolution.mode,
      answeredClarifications.length ? "user_clarified" : "direct_extract",
    ),
    status: nonEmpty(
      previousResolution.status,
      disposition === "accepted" && !unresolved.length && !unanswered.length ? "resolved" : "pending",
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
    unresolved_structural_ambiguities: unresolved,
  };
  return next;
}

export function pendingClarificationQuestion(data: any): ClarificationItem | null {
  const clarifications: ClarificationItem[] = data?.input_resolution?.clarifications || [];
  return clarifications.find((item) => !item.answer) || null;
}

export function applyClarificationAnswer(
  data: any,
  answer: string,
  options: { question_id?: string; answered_at?: string } = {},
): any {
  const next = ensureStage01ContractFields(
    JSON.parse(JSON.stringify(data || {})),
    String(data?.original_input || data?.normalized_question || ""),
  );
  const clarifications: ClarificationItem[] = [...(next.input_resolution.clarifications || [])];
  const targetId = options.question_id
    || pendingClarificationQuestion(next)?.question_id
    || clarifications[clarifications.length - 1]?.question_id;
  if (!targetId) throw new Error("当前没有待回答的澄清问题");
  const index = clarifications.findIndex((item) => item.question_id === targetId);
  if (index < 0) throw new Error(`找不到澄清问题 ${targetId}`);
  if (clarifications[index].answer) throw new Error(`${targetId} 已有回答，请等待下一轮生成`);
  const trimmed = String(answer || "").trim();
  if (!trimmed) throw new Error("澄清回答不能为空");
  clarifications[index] = {
    ...clarifications[index],
    answer: trimmed,
    answered_at: options.answered_at || new Date().toISOString(),
  };
  next.input_resolution = {
    ...next.input_resolution,
    mode: "user_clarified",
    status: "pending",
    clarifications,
    // 已答问题从 unresolved 中移除同主题占位；正式是否 resolved 由下一轮生成裁定
    unresolved_structural_ambiguities: (next.input_resolution.unresolved_structural_ambiguities || [])
      .filter((item: string) => !item.includes(clarifications[index].topic)),
  };
  next.task_disposition = "needs_clarification";
  next.stage_status = "in_progress";
  next.quality_status = "draft";
  return next;
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
  const quality = String(data?.quality_status || "");
  if (!["minimum_pass", "high_quality_pass"].includes(quality)) {
    throw new Error("quality_status 须为 minimum_pass 或 high_quality_pass 才能确认");
  }
}
