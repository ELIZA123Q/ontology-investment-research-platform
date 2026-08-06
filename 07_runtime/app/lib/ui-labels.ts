/** 研究员可见文案：内部枚举/代号 → 中文。 */

import { journeyJobHref } from "@/app/lib/research-journey";

export function stageLabel(stage: string | number): string {
  const key = typeof stage === "number" ? `stage_0${stage}` : stage;
  return (
    {
      stage_01: "范围",
      stage_02: "结构",
      stage_03: "证据",
      stage_04: "判断",
      stage_05: "交付",
      "1": "范围",
      "2": "结构",
      "3": "证据",
      "4": "判断",
      "5": "交付",
    } as Record<string, string>
  )[key] || String(stage);
}

export function artifactKindLabel(kind: string): string {
  return (
    {
      stage_01: "研究范围",
      stage_02: "研究结构",
      stage_03: "证据",
      stage_04: "判断",
      stage_05: "报告表达",
      baseline: "同证据对照基线",
      evaluation: "A/B 盲评",
      independent_review: "独立审阅",
      change_set: "增量变更",
    } as Record<string, string>
  )[kind] || kind;
}

export function artifactStatusLabel(status: string): string {
  return (
    {
      draft: "草稿",
      running: "生成中",
      needs_review: "待确认",
      approved: "已确认",
      failed: "失败",
      cancelled: "已取消",
      superseded: "已被新版取代",
    } as Record<string, string>
  )[status] || status;
}

/** 状态栏模型片段：running 时缺省不得误写成「未使用模型」。 */
export function artifactModelLabel(modelName: string | null | undefined, status?: string): string {
  if (modelName) return modelName;
  if (status === "running") return "模型调用中";
  return "未使用模型";
}

export function runStatusLabel(status: string): string {
  return (
    {
      draft: "草稿",
      active: "进行中",
      in_progress: "进行中",
      complete: "已完成",
      completed: "已完成",
      archived: "已归档",
      blocked: "受阻",
    } as Record<string, string>
  )[status] || status;
}

export function researchJobStatusLabel(status: string): string {
  return (
    {
      queued: "已排队",
      running: "执行中",
      waiting_for_review: "等待人工确认",
      waiting_for_input: "等待补充输入",
      retrying: "等待重试",
      blocked: "已停止重试",
      completed: "已完成",
      cancelled: "已取消",
    } as Record<string, string>
  )[status] || status;
}

export function researchJobIssueMessage(value: unknown): string {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!raw) return "";
  if (/402|insufficient balance|quota|credit balance|余额不足/.test(normalized)) {
    return "模型服务额度暂时不足，本次生成未完成。已保存的输入和先前版本不会丢失；补充额度后可重新提交。";
  }
  if (/worker.*(?:heartbeat|心跳)|心跳超时|lease expired|租约|服务中断|从阶段起点重试/.test(normalized)) {
    return "上次生成意外中断，已保存的输入和先前版本不会丢失；请重新提交当前阶段。";
  }
  if (/terminated|killed|cancelled|canceled|sigkill/.test(normalized)) {
    return "上次生成已提前结束，已保存的输入和先前版本不会丢失；请重新提交当前阶段。";
  }
  if (/job_budget|over.?budget|token.*budget|cost.*budget|预算上限/.test(normalized)) {
    return "本轮已达到任务预算上限；请先检查现有输出，或收窄研究范围后继续。";
  }
  if (/确定性本体规则未通过|未提交合法结构化|invalid_type|too_big|expected (?:array|string|number|object)|method_applications|judgment_reference_integrity|precondition/.test(normalized)) {
    return "本轮草稿未通过结构与证据规则校验，因此没有进入人工确认。请重新生成；如连续失败，可改用页面中的手动路径。";
  }
  // 确定性校验/质量门失败：这是用户可定位、需要补证或重新生成的问题，绝不是技术故障。
  // 这类信息本就较长，绝不能套用下方“技术错误/请重新提交”的兜底而误导用户去重新提交当前阶段。
  if (/质量门|质量门禁|本体约束预检|可交接密度|挡门|待修复阻断|需补证|重新生成后再确认|未获人工批准|未创建审阅工作项|output_contract|跨阶段引用断裂|双产物/.test(raw)) {
    return raw.length > 600 ? raw.slice(0, 600) + "…" : raw;
  }
  if (raw.length > 180 || /deepseek|traceback|syntaxerror|typeerror|zod|json/i.test(raw)) {
    return "生成任务返回了技术错误，详细日志已保留在审计记录。请重新提交当前阶段。";
  }
  return raw;
}

export function researchJobRecoveryHref(runId: string, stage: string | number, jobStatus?: string | null): string {
  return journeyJobHref(runId, stage, jobStatus);
}

export function latestJobPerRun<T extends { run_id: string; updated_at: string }>(jobs: T[]): T[] {
  const seen = new Set<string>();
  return [...jobs]
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .filter((job) => {
      if (seen.has(job.run_id)) return false;
      seen.add(job.run_id);
      return true;
    });
}

export function latestJobForStage<T extends { stage: string; created_at: string }>(jobs: T[], stage: string): T | undefined {
  return jobs
    .filter((job) => job.stage === stage)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
}

export function differenceCauseLabel(cause: string): string {
  return (
    {
      evidence_change: "证据变化",
      method_change: "研究方法变化",
      model_change: "生成方式变化",
      runtime_configuration_change: "运行配置变化",
      model_variation: "同样输入下的结果波动",
      no_judgment_change: "判断未变化",
    } as Record<string, string>
  )[cause] || "其他变化";
}

export function sourceTierLabel(tier: string): string {
  const level = Number(/^S([1-8])$/i.exec(String(tier || ""))?.[1] || 8);
  if (level <= 3) return "高权威来源";
  if (level <= 6) return "可用公开来源";
  return "低权威线索";
}

export function publishStatusLabel(status: string): string {
  return (
    {
      draft: "草稿",
      ready: "可交付",
      published: "已发布",
      blocked: "不可交付",
      workbench_only: "仅工作台运行",
      workbench_export_only: "仅工作台导出",
      workbench_validate_passed: "工作台导出校验通过",
      workbench_validate_failed: "工作台导出校验未通过",
    } as Record<string, string>
  )[status] || status;
}

export function authorityLabel(authority: string): string {
  return (
    {
      approved_graph: "正式关系图",
      formal: "正式关系图",
      semantic_fixture: "预置样例图",
      provisional: "草稿预览",
      empty: "尚无关系图",
      none: "尚无关系图",
    } as Record<string, string>
  )[authority] || authority;
}

export function actionLabel(actionId: string): string {
  return (
    {
      AssessEvidenceForUse: "评估证据是否可用",
      FormJudgment: "形成判断",
      RecordReasoningTrace: "记录推理过程",
      LinkOntologyObjects: "建立本体关系",
      UpdateTrackingSignal: "更新跟踪信号",
      InvalidateJudgment: "标记判断失效",
    } as Record<string, string>
  )[actionId] || actionId;
}

export function objectTypeLabel(type: string): string {
  return (
    {
      ResearchQuestion: "研究问题",
      JudgmentUnit: "判断单元",
      Judgment: "判断",
      EvidenceFact: "已确认事实",
      EvidenceClaim: "证据主张",
      EvidenceRequirement: "证据要求",
      EvidenceAssessment: "证据评估",
      EvidenceBasket: "证据篮子",
      SourceDocument: "来源文档",
      Hypothesis: "假设",
      Signal: "信号",
      CompetingExplanation: "竞争解释",
      RuleEvaluation: "规则评估",
      ReasoningTrace: "推理留痕",
      BlockingFactor: "阻断因素",
      TrackingSignal: "跟踪信号",
      MethodApplication: "方法应用",
      ResearchScope: "研究范围",
      ResearchPath: "研究路径",
      StateVariable: "状态变量",
      Industry: "产业",
      ValueChainSegment: "产业链环节",
      Product: "产品",
      Application: "应用场景",
      Company: "公司",
      ManufacturingFacility: "制造设施",
    } as Record<string, string>
  )[type] || type;
}

export function relationTypeLabel(type: string): string {
  return (
    {
      questionDecomposesIntoUnit: "拆分为判断单元",
      questionDecomposesIntoSubQuestion: "分解为子问题",
      unitUsesScope: "使用研究范围",
      scopeIncludesObject: "范围包含",
      unitEvaluatesStateVariable: "评估状态变量",
      unitHasHypothesis: "检验假设",
      judgmentResolvesUnit: "裁决判断单元",
      judgmentBasedOnHypothesis: "基于假设",
      requirementForJudgmentUnit: "服务于判断单元",
      basketFulfillsRequirement: "满足证据要求",
      basketIncludesAssessment: "包含证据评估",
      assessmentEvaluatesFact: "评估事实",
      signalGroundedByFact: "由事实支撑",
      signalEvaluatesHypothesis: "检验假设",
      factDerivedFromClaim: "来自证据主张",
      claimCitesSource: "引用来源",
      supports: "支持",
      weakens: "削弱",
      derivedFrom: "来自",
      basedOn: "依据",
      targets: "指向",
      affects: "影响",
      requires: "需要",
    } as Record<string, string>
  )[type] || type;
}

export function usabilityLabel(status: string): string {
  return (
    {
      usable: "可用",
      candidate: "候选",
      rejected: "已退回",
      blocked: "不可用",
      limited: "仅作线索",
    } as Record<string, string>
  )[status] || status;
}

export function retrievalLabel(status: string): string {
  return (
    {
      captured: "正文已抓取",
      not_attempted: "尚未抓取",
      failed: "抓取失败",
      pending: "抓取中",
      limited: "正文不完整",
    } as Record<string, string>
  )[status] || status;
}

export function evidenceKindLabel(kind: string): string {
  return (
    {
      source_claim: "来源事实",
      fact_draft: "待核对事实",
      counter: "反证",
      gap: "尚缺的证据",
      conflict: "相互矛盾",
      background: "背景",
    } as Record<string, string>
  )[kind] || kind;
}

export function workItemKindLabel(kind: string): string {
  return (
    {
      evidence_review: "证据审阅",
      judgment_review: "判断确认",
      gap_acceptance: "确认暂缺（限制结论）",
      action_approval: "批准操作建议",
      independent_review: "独立审阅",
    } as Record<string, string>
  )[kind] || kind;
}

export function verdictLabel(verdict: string): string {
  return ({ pass: "通过", rework: "退回修改" } as Record<string, string>)[verdict] || verdict;
}

export function directionLabel(direction: string): string {
  return (
    {
      support: "支持",
      weaken: "削弱 / 反证",
      neutral: "背景 / 中性",
      unknown: "未标注",
    } as Record<string, string>
  )[direction] || direction;
}

export function confidenceLabel(confidence: string): string {
  return ({ high: "高", medium: "中", low: "低" } as Record<string, string>)[confidence] || confidence;
}

export function workItemStatusLabel(status: string): string {
  return (
    {
      pending: "待核对",
      approved: "已确认",
      rework: "退回修改",
      dismissed: "已驳回",
      superseded: "已被取代",
    } as Record<string, string>
  )[status] || status;
}

export function authorityTypeLabel(type: string): string {
  return (
    {
      official: "监管 / 官方原文",
      company_disclosure: "公司披露",
      industry_provider: "行业数据 / 协会统计",
      public_secondary: "公开二手",
      unknown: "未分类",
    } as Record<string, string>
  )[type] || type;
}

export function evidenceRoleLabel(role: string): string {
  return (
    {
      support: "支持",
      counter: "反证",
      context: "背景",
      boundary: "边界",
    } as Record<string, string>
  )[role] || role;
}

export function directnessLabel(directness: string): string {
  return (
    {
      direct: "直接",
      indirect: "间接",
      proxy: "代理",
    } as Record<string, string>
  )[directness] || directness;
}

export function reviewSuggestionLabel(suggestion: string): string {
  return (
    {
      accept_evidence: "建议确认可用",
      accept_gap: "建议确认暂缺（限制结论）",
      rework: "建议退回修改",
      review_manually: "建议人工复核",
    } as Record<string, string>
  )[suggestion] || suggestion;
}
