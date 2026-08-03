export type OntologyTabId = "network" | "catalog" | "comparability" | "queries" | "governance";
export type OntologyTabGroup = "use" | "reuse" | "publish";

export type TabGuide = {
  id: OntologyTabId;
  group: OntologyTabGroup;
  label: string;
  blurb: string;
  answers: string;
  sees: string[];
  nextUse: string;
};

export const TAB_GROUPS: Array<{ id: OntologyTabGroup; label: string; hint: string; demoted?: boolean }> = [
  { id: "use", label: "1 · 用于本研究", hint: "核对本轮实际使用的语义与规则" },
  { id: "reuse", label: "2 · 跨研究复用", hint: "按统一口径查询与比较" },
  { id: "publish", label: "3 · 治理与发布", hint: "把候选知识变成正式版本并导出", demoted: true },
];

export const TAB_GUIDE: TabGuide[] = [
  {
    id: "network",
    group: "use",
    label: "研究知识网络",
    blurb: "本轮研究实际用到了哪些类型与规则",
    answers: "本轮使用了哪些知识节点与规则？",
    sees: ["默认只显示研究相关子图", "可切换完整网络做排查", "与上方「补全 / 限制 / 关联」对照"],
    nextUse: "用来核对系统补全与约束是否合理，而不是浏览完整大图。",
  },
  {
    id: "catalog",
    group: "use",
    label: "类型目录",
    blurb: "查某个类型的定义，以及本轮有没有实例",
    answers: "这个类型是什么、本轮有没有实例？",
    sees: ["类型定义、属性与关系端点", "本轮对应实例列表", "可执行操作提示"],
    nextUse: "避免把「类型存在」当成「本轮已用」；有实例再回结构/证据页核对。",
  },
  {
    id: "comparability",
    group: "reuse",
    label: "跨研究口径",
    blurb: "同名正式变量能不能直接对比",
    answers: "这两个变量能不能直接比？",
    sees: ["可比 / 不可直比 / 信息不足三态", "对象、指标、单位、时间基准等口径", "阻断或信息不足的具体原因"],
    nextUse: "写跨研究结论前先看这里，避免混口径。",
  },
  {
    id: "queries",
    group: "reuse",
    label: "研究问题查询",
    blurb: "证据影响哪些判断、变量出现在哪些研究",
    answers: "证据/变量的下游影响是什么？",
    sees: ["证据 → 判断的正式影响路径", "变量跨研究出现位置", "正式知识与本轮候选区分"],
    nextUse: "评估补证与改判的波及面，再回到证据台或判断审阅。",
  },
  {
    id: "governance",
    group: "publish",
    label: "知识缺口治理",
    blurb: "专家确认候选缺口，创建并跟踪正式变更提案",
    answers: "哪些本轮候选值得进入正式知识库？",
    sees: ["统一语义目录、数据映射与运行基线状态", "跨研究频次与复用信号", "候选确认、变更受理与正式发布状态"],
    nextUse: "候选受理后必须经过影响分析、批准、实施和验证；只有绑定正式指纹后才算发布。",
  },
];

export function displayComparisonField(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.map(String).join("、") || fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function tabHref(tabId: OntologyTabId, runId?: string): string {
  if (tabId === "governance" || tabId === "comparability") return `/ontology?tab=${tabId}`;
  if (tabId === "queries") return `/ontology?tab=queries${runId ? `&queryRunId=${runId}` : ""}`;
  return `/ontology?tab=${tabId}${runId ? `&runId=${runId}` : ""}`;
}

export function knowledgeSourceLabel(sourceFile: string): string {
  if (sourceFile.includes("semiconductor")) return "半导体领域知识";
  if (sourceFile.includes("/rules/")) return "判断与约束规则";
  if (sourceFile.includes("01_通用")) return "通用研究知识";
  return "正式知识库";
}

export function knowledgeCategoryLabel(category: string): string {
  return ({
    Object: "对象类型",
    Relation: "关系类型",
    Rule: "研究规则",
    Scenario: "研究场景",
  } as Record<string, string>)[category] || category;
}
