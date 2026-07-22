/** 研究员可见文案：内部枚举/代号 → 中文。 */

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
      UpdateTrackingSignal: "更新跟踪信号",
      InvalidateJudgment: "标记判断失效",
    } as Record<string, string>
  )[actionId] || actionId;
}

export function objectTypeLabel(type: string): string {
  return (
    {
      JudgmentUnit: "判断单元",
      Judgment: "判断",
      EvidenceFact: "已确认事实",
      EvidenceClaim: "证据主张",
      SourceDocument: "来源文档",
      Hypothesis: "假设",
      Signal: "信号",
      CompetingExplanation: "竞争解释",
      RuleEvaluation: "规则评估",
      ReasoningTrace: "推理留痕",
      BlockingFactor: "阻断因素",
      TrackingSignal: "跟踪信号",
      Industry: "产业",
      ValueChainSegment: "产业链环节",
      Product: "产品",
      Application: "应用场景",
      Company: "公司",
      ManufacturingFacility: "制造设施",
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
    } as Record<string, string>
  )[status] || status;
}

export function evidenceKindLabel(kind: string): string {
  return (
    {
      fact_draft: "事实草稿",
      counter: "反证",
      gap: "缺口",
      conflict: "冲突",
      background: "背景",
    } as Record<string, string>
  )[kind] || kind;
}

export function workItemKindLabel(kind: string): string {
  return (
    {
      evidence_review: "证据审阅",
      judgment_review: "判断确认",
      gap_acceptance: "接受证据缺口",
      action_approval: "批准操作建议",
      independent_review: "独立审阅",
    } as Record<string, string>
  )[kind] || kind;
}

export function verdictLabel(verdict: string): string {
  return ({ pass: "通过", rework: "需返工" } as Record<string, string>)[verdict] || verdict;
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
      pending: "待审阅",
      approved: "已确认",
      rework: "退回补证",
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
      accept_gap: "建议接受缺口",
      rework: "建议退回补证",
      review_manually: "建议人工复核",
    } as Record<string, string>
  )[suggestion] || suggestion;
}
