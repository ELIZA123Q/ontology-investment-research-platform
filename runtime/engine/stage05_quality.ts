/**
 * Stage05 交付结构校验（对齐 governance validate_05_outputs.REQUIRED_FIXED_SECTIONS）。
 * 用于 Runtime 确认门禁；不替代完整 Python 发布包校验。
 *
 * minimum_pass：固定节 + 论点章 + 禁审计腔/压平简报
 * high_quality_pass：额外要求 Research Edge 实质字段、论点章密度、可执行跟踪表、
 *   deterministic_check_status=checked；禁止占位 research_edge / skeleton 冒充。
 */

export const STAGE05_REQUIRED_FIXED_SECTIONS = [
  "投资要点",
  "核心结论概览",
  "市场认知差 / Research Edge",
  "投资含义与重点观察",
  "催化、验证与风险",
  "主要资料来源",
] as const;

export const STAGE05_REQUIRED_TAIL_MARKERS = ["未来重点观察", "主要风险"] as const;

const ARGUMENT_CHAPTER_PATTERN = /^##\s+[一二三四五]、/gm;
const MIN_ARGUMENT_CHAPTERS = 2;
const MAX_ARGUMENT_CHAPTERS = 5;

/** high_quality：每个论点章最少正文汉字/字符（对标 7:13 金标密度启发式）。 */
export const HQ_MIN_ARGUMENT_CHAPTER_CHARS = 280;
/** high_quality：Research Edge 表格至少实质行数（不含表头）。 */
export const HQ_MIN_RESEARCH_EDGE_ROWS = 1;
/** 占位 research_edge 文案（不得标 high_quality）。 */
export const RESEARCH_EDGE_PLACEHOLDER_MARKERS = [
  "见正文「市场认知差 / Research Edge」",
  "见正文表格",
  "见正文证伪列",
  "见正文证据边界列",
  "需由后续证据补足",
];

/** 高可见位置禁止的机器审计腔（不含研究叙述里常见的「不是确定结束日」等合法表述）。 */
const HIGH_VISIBILITY_AUDIT_MARKERS = [
  "J0/",
  "J1/",
  "J2/",
  "J3/",
  "J4/",
  "/supported",
  "/indeterminate",
  "/blocked",
  "/contested",
  "<details>",
  "审计索引",
  "ReportClaim",
  "MethodApplication：",
  "MethodApplication:",
  "EvidenceFact",
  "intensity_lifted",
  "不得写成",
  "不能写成",
  "禁止给出",
];

const FORBIDDEN_BODY_TERMS = [
  "证据门禁",
  "包级准入",
  "allowed_04_output",
  "judgment_unit",
  "state_variable",
  "path_readiness",
  "manifest.csv",
  "推理审计",
  "本体视图",
  "倾向判断：",
  "条件判断：",
  "已确认：",
  "暂不可判断：",
  "判断单元",
  "状态变量",
  "路径节点",
];

const FLAT_BRIEF_MARKERS = [
  "## 结论先行",
  "## 判断依据与改判条件",
  "## 研究判断简报",
  "研究判断简报｜",
];

const TRACKING_TABLE_HEADERS = ["当前基线", "触发条件", "对判断的影响"];
const NUMERIC_OR_GAP_PATTERN = /\d|\d%|缺口|暂无|不足|无法核验|待补齐|公开材料不足以/;

export type Stage05StructureIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

function nonEmpty(value: unknown): string {
  return String(value ?? "").trim();
}

export function countArgumentChapters(body: string): number {
  const matches = body.match(ARGUMENT_CHAPTER_PATTERN);
  return matches?.length ?? 0;
}

export function hasStage05FixedSections(body: string): boolean {
  const text = String(body || "");
  return STAGE05_REQUIRED_FIXED_SECTIONS.every((section) => stage05SectionPresent(text, section));
}

/** 允许 Research Edge 等节名的常见变体，避免因少一个斜杠就压成骨架。 */
export function stage05SectionPresent(body: string, section: string): boolean {
  if (body.includes(`## ${section}`)) return true;
  if (section === "市场认知差 / Research Edge") {
    return /##\s*市场认知差/.test(body)
      || /##\s*Research\s*Edge/i.test(body)
      || /##\s*认知差/.test(body);
  }
  if (section === "投资含义与重点观察") {
    return /##\s*投资含义/.test(body) || /##\s*重点观察/.test(body);
  }
  if (section === "催化、验证与风险") {
    return /##\s*催化/.test(body) || /##\s*验证与风险/.test(body) || /##\s*风险与验证/.test(body);
  }
  if (section === "主要资料来源") {
    return /##\s*主要资料来源/.test(body) || /##\s*资料来源/.test(body) || /##\s*参考资料/.test(body);
  }
  return false;
}

/** 是否已具备正式研报骨架（固定节 + 2–5 论点章）。 */
export function hasPublishableStage05Structure(body: string): boolean {
  const chapters = countArgumentChapters(body);
  return hasStage05FixedSections(body)
    && chapters >= MIN_ARGUMENT_CHAPTERS
    && chapters <= MAX_ARGUMENT_CHAPTERS;
}

/** 是否像被压平的简报骨架（不得当作正式成品）。 */
export function looksLikeFlattenedBrief(body: string): boolean {
  const text = nonEmpty(body);
  if (!text) return true;
  if (FLAT_BRIEF_MARKERS.some((marker) => text.includes(marker))) return true;
  if (text.includes("<details>") && text.includes("审计索引")) return true;
  return false;
}

/** 是否像确定性骨架模板（可作 minimum 草稿，不得标 high_quality）。 */
export function looksLikeDeterministicSkeleton(body: string): boolean {
  const text = nonEmpty(body);
  if (!text) return false;
  const skeletonMarkers = [
    "仅限已确认判断卡",
    "当前没有可支撑方向判断的事实级来源；结论保持不可判断边界",
    "配对审计见 expression_audit_yaml",
  ];
  const hit = skeletonMarkers.filter((marker) => text.includes(marker)).length;
  return hit >= 2;
}

/** LLM/人工稿是否应保留（有研报节或论点章，且不是压平简报）。 */
export function shouldPreserveStage05Markdown(body: string): boolean {
  const text = nonEmpty(body);
  if (!text || text === "placeholder" || text.length < 80) return false;
  if (looksLikeFlattenedBrief(text)) return false;
  if (hasStage05FixedSections(text)) return true;
  if (countArgumentChapters(text) >= MIN_ARGUMENT_CHAPTERS && /##\s*投资要点/.test(text)) return true;
  if (
    text.length >= 1200
    && countArgumentChapters(text) >= MIN_ARGUMENT_CHAPTERS
    && stage05SectionPresent(text, "市场认知差 / Research Edge")
    && /##\s*投资要点/.test(text)
  ) {
    return true;
  }
  return false;
}

function extractHighVisibilitySlices(body: string): Array<{ label: string; text: string }> {
  const slices: Array<{ label: string; text: string }> = [];
  const titleMatch = body.match(/^#\s+(.+)$/m);
  if (titleMatch) slices.push({ label: "标题", text: titleMatch[1] });
  const pointsIdx = body.indexOf("## 投资要点");
  if (pointsIdx >= 0) {
    const rest = body.slice(pointsIdx);
    const next = rest.search(/\n##\s+/);
    const block = next > 0 ? rest.slice(0, next) : rest.slice(0, 1200);
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
        slices.push({ label: "投资要点", text: trimmed });
      }
    }
  }
  const overviewIdx = body.indexOf("## 核心结论概览");
  if (overviewIdx >= 0) {
    const rest = body.slice(overviewIdx);
    const next = rest.search(/\n##\s+/);
    const block = next > 0 ? rest.slice(0, next) : rest.slice(0, 1500);
    for (const line of block.split("\n")) {
      if (line.includes("|") && !line.includes("---")) {
        slices.push({ label: "核心结论概览", text: line });
      }
    }
  }
  return slices;
}

/** 切出 `## 一、`…`## 五、` 各章正文（不含下一章标题）。 */
export function extractArgumentChapterBodies(body: string): Array<{ heading: string; body: string }> {
  const text = nonEmpty(body);
  const matches = [...text.matchAll(/^##\s+([一二三四五]、.+)$/gm)];
  const chapters: Array<{ heading: string; body: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const rest = text.slice(start, end);
    const fixedCut = rest.search(/\n## (?![一二三四五]、)/);
    const chapterBody = (fixedCut >= 0 ? rest.slice(0, fixedCut) : rest).trim();
    chapters.push({ heading: matches[i][1], body: chapterBody });
  }
  return chapters;
}

export function isPlaceholderResearchEdge(edge: {
  market_view?: string;
  differentiated_view?: string;
  falsifier?: string;
  evidence_boundary?: string;
  underestimated_mechanism?: string;
}): boolean {
  const blob = [
    edge.market_view,
    edge.differentiated_view,
    edge.falsifier,
    edge.evidence_boundary,
    edge.underestimated_mechanism,
  ].map((item) => nonEmpty(item)).join("\n");
  if (!blob) return true;
  return RESEARCH_EDGE_PLACEHOLDER_MARKERS.some((marker) => blob.includes(marker));
}

function countResearchEdgeTableRows(body: string): number {
  const idx = body.indexOf("## 市场认知差 / Research Edge");
  if (idx < 0) return 0;
  const rest = body.slice(idx);
  const next = rest.search(/\n##\s+/);
  const block = next > 0 ? rest.slice(0, next) : rest;
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .filter((line) => {
      const firstCell = (line.split("|")[1] || "").trim();
      return firstCell && !/参考认识|常见认识|市场认知|项目/.test(firstCell);
    })
    .filter((line) => (line.match(/\|/g) || []).length >= 4)
    .length;
}

function hasExecutableTrackingTable(body: string): boolean {
  const idx = body.indexOf("## 催化、验证与风险");
  if (idx < 0) return false;
  const block = body.slice(idx, idx + 2500);
  return TRACKING_TABLE_HEADERS.every((header) => block.includes(header))
    && block.includes("|");
}

/**
 * high_quality 额外形态检查（对标 7:13 金标启发式）。
 * 不替代完整 00A 语义审查。
 */
export function collectStage05HighQualityIssues(input: {
  body: string;
  research_edge?: Array<Record<string, unknown>>;
  deterministic_check_status?: string;
  from_skeleton?: boolean;
}): Stage05StructureIssue[] {
  const issues: Stage05StructureIssue[] = [];
  const text = nonEmpty(input.body);
  if (input.from_skeleton || looksLikeDeterministicSkeleton(text)) {
    issues.push({
      severity: "error",
      code: "skeleton_not_high_quality",
      message: "确定性骨架/模板稿不得标 high_quality_pass",
    });
  }

  const edges = Array.isArray(input.research_edge) ? input.research_edge : [];
  const substantiveEdges = edges.filter((edge) => !isPlaceholderResearchEdge(edge as any));
  if (!substantiveEdges.length && countResearchEdgeTableRows(text) < HQ_MIN_RESEARCH_EDGE_ROWS) {
    issues.push({
      severity: "error",
      code: "research_edge_thin",
      message: "high_quality 要求 Research Edge 有实质行（常见认识/研究判断/被低估机制/证伪），不得用占位文案",
    });
  }
  for (const edge of substantiveEdges) {
    const market = nonEmpty(edge.market_view);
    const diff = nonEmpty(edge.differentiated_view);
    const falsifier = nonEmpty(edge.falsifier);
    const mechanism = nonEmpty(edge.underestimated_mechanism);
    if (!market || !diff) {
      issues.push({
        severity: "error",
        code: "research_edge_incomplete",
        message: "Research Edge 每行须含常见认识与研究判断",
      });
      break;
    }
    if (!falsifier && !mechanism && !nonEmpty(edge.evidence_boundary)) {
      issues.push({
        severity: "warning",
        code: "research_edge_weak_falsifier",
        message: "Research Edge 建议补齐证伪条件或被低估机制",
      });
    }
  }

  const chapters = extractArgumentChapterBodies(text);
  for (const chapter of chapters) {
    if (chapter.body.length < HQ_MIN_ARGUMENT_CHAPTER_CHARS) {
      issues.push({
        severity: "error",
        code: "argument_chapter_thin",
        message: `论点章「${chapter.heading}」正文过短（<${HQ_MIN_ARGUMENT_CHAPTER_CHARS} 字），不足以支撑研报级论证`,
      });
    }
    if (!NUMERIC_OR_GAP_PATTERN.test(chapter.body)) {
      issues.push({
        severity: "error",
        code: "argument_chapter_ungrounded",
        message: `论点章「${chapter.heading}」须含可追溯数字或明确缺口说明`,
      });
    }
  }

  if (!hasExecutableTrackingTable(text)) {
    issues.push({
      severity: "error",
      code: "tracking_table_missing",
      message: "「催化、验证与风险」须含可执行跟踪表（基线/触发/对判断影响）",
    });
  }

  if (nonEmpty(input.deterministic_check_status) !== "checked") {
    issues.push({
      severity: "error",
      code: "deterministic_not_checked",
      message: "high_quality_pass 要求 deterministic_check_status=checked",
    });
  }

  return issues;
}

export function collectStage05StructureIssues(body: string): Stage05StructureIssue[] {
  const issues: Stage05StructureIssue[] = [];
  const text = nonEmpty(body);
  if (!text || text.length < 80) {
    issues.push({ severity: "error", code: "missing_body", message: "缺少合格的研究报告正文" });
  }
  if (text.startsWith("---")) {
    issues.push({
      severity: "error",
      code: "yaml_frontmatter",
      message: "05 正式交付正文不得使用 YAML front matter，应从标题开始",
    });
  }
  for (const section of STAGE05_REQUIRED_FIXED_SECTIONS) {
    if (!stage05SectionPresent(text, section)) {
      issues.push({
        severity: "error",
        code: "missing_fixed_section",
        message: `缺少固定节「${section}」`,
      });
    }
  }
  const chapters = countArgumentChapters(text);
  if (chapters < MIN_ARGUMENT_CHAPTERS || chapters > MAX_ARGUMENT_CHAPTERS) {
    issues.push({
      severity: "error",
      code: "argument_chapter_count",
      message: `论点章（## 一、…）须为 ${MIN_ARGUMENT_CHAPTERS}–${MAX_ARGUMENT_CHAPTERS} 个，当前 ${chapters}`,
    });
  }
  for (const marker of STAGE05_REQUIRED_TAIL_MARKERS) {
    if (!text.includes(marker)) {
      issues.push({
        severity: "warning",
        code: "missing_tail_marker",
        message: `催化/风险区建议包含「${marker}」`,
      });
    }
  }
  if (text && looksLikeFlattenedBrief(text)) {
    issues.push({
      severity: "error",
      code: "flattened_brief",
      message: "正文仍是研究判断简报压平骨架，不是正式研报形态",
    });
  }
  for (const slice of extractHighVisibilitySlices(text)) {
    for (const marker of HIGH_VISIBILITY_AUDIT_MARKERS) {
      if (slice.text.includes(marker)) {
        issues.push({
          severity: "error",
          code: "audit_register_voice",
          message: `${slice.label} 不得出现审计腔或机器字段：「${marker}」`,
        });
        break;
      }
    }
  }
  if (text.includes("<details>") && text.includes("审计索引")) {
    issues.push({
      severity: "error",
      code: "inline_audit_details",
      message: "正文不得内嵌 <details>审计索引；审计只保留在 expression_audit_yaml",
    });
  }
  for (const term of FORBIDDEN_BODY_TERMS) {
    if (text.includes(term)) {
      issues.push({
        severity: "warning",
        code: "forbidden_body_term",
        message: `正文不宜出现内部术语：「${term}」`,
      });
    }
  }
  return issues;
}

export function assertStage05StructureReady(body: string) {
  const errors = collectStage05StructureIssues(body).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(`Stage05 研报结构未达标：${errors.map((item) => item.message).join("；")}`);
  }
}

/** 去掉正文中的审计 details 块，保留研究叙述。 */
export function stripInlineAuditDetails(body: string): string {
  return body.replace(/<details>\s*<summary>审计索引<\/summary>[\s\S]*?<\/details>/gi, "").trim();
}

/**
 * 确定性草稿骨架：05C 固定节 + 最少 2 个论点章，无审计腔。
 * 仅作 deterministic_projection / 缺稿回填，不是正式默认成品形态。
 */
export function buildStage05SkeletonMarkdown(input: {
  title: string;
  question: string;
  executivePoints: string[];
  claims: Array<{
    id: string;
    statement: string;
    judgmentTitles?: string[];
    conclusions?: string[];
    sourceLines?: string[];
    uncertainties?: string[];
    invalidations?: string[];
  }>;
  limitations: string[];
  sourceLines: string[];
}): string {
  const title = nonEmpty(input.title) || "行业周期判断";
  const points = input.executivePoints.length
    ? input.executivePoints.map((item) => `- **${item.replace(/^-\s*/, "")}**`)
    : ["- **当前证据不足，暂不能形成方向性周期结论。** 以下仅复述已确认判断边界。"];
  const claimBlocks = input.claims.length
    ? input.claims.map((claim, index) => {
      const ordinal = ["一", "二", "三", "四", "五"][index] || String(index + 1);
      const heading = (claim.judgmentTitles || []).filter(Boolean).join("与") || claim.statement.slice(0, 40) || claim.id;
      const conclusions = (claim.conclusions || []).length
        ? (claim.conclusions || []).map((line) => `- ${line}`).join("\n")
        : `- ${claim.statement}`;
      const evidence = (claim.sourceLines || []).length
        ? (claim.sourceLines || []).map((line) => `- ${line}`).join("\n")
        : "- 当前没有可支撑方向判断的事实级来源；结论保持不可判断边界。";
      const uncertainties = (claim.uncertainties || []).length
        ? (claim.uncertainties || []).map((line) => `- ${line}`).join("\n")
        : "- 未登记额外不确定性。";
      const invalidations = (claim.invalidations || []).length
        ? (claim.invalidations || []).map((line) => `- ${line}`).join("\n")
        : "- 未登记额外改判条件。";
      return [
        `## ${ordinal}、${heading}`,
        "",
        conclusions,
        "",
        "关键依据：",
        "",
        evidence,
        "",
        "边界与改判：",
        "",
        uncertainties,
        "",
        invalidations,
      ].join("\n");
    })
    : [
      "## 一、当前阶段尚不能确认",
      "",
      "- 上游判断未形成可表达主张，本稿只保留边界。",
      "",
      "## 二、后续验证窗口",
      "",
      "- 取得可核验事实后再进入方向判断。",
    ];

  if (input.claims.length === 1) {
    claimBlocks.push([
      "## 二、验证与改判条件",
      "",
      ...(input.limitations.length
        ? input.limitations.map((item) => `- ${item}`)
        : ["- 在新的事实级证据出现前，不外推行业方向。"]),
    ].join("\n"));
  }

  const overviewRows = input.claims.length
    ? input.claims.map((claim) => `| ${claim.id} | ${claim.statement.replace(/\|/g, "/")} |`)
    : ["| 当前判断 | 证据不足，暂不可形成方向结论 |"];

  const edgeRows = [
    "| 参考认识 | 本次差异化判断 | 被低估的机制 | 什么会证伪 | 证据边界 |",
    "|---|---|---|---|---|",
    `| 常见叙事或原判断 | ${points[0]?.replace(/^-\s*\*\*/, "").replace(/\*\*.*$/, "") || "边界判断"} | 需由后续证据补足 | 关键指标连续转弱或转强 | 仅限已确认判断卡 |`,
  ];

  return [
    `# ${title}`,
    "",
    `研究问题：${input.question || "（未提供）"}`,
    "",
    "## 投资要点",
    "",
    ...points,
    "",
    "## 核心结论概览",
    "",
    "| 项目 | 结论 |",
    "|---|---|",
    ...overviewRows,
    "",
    "## 市场认知差 / Research Edge",
    "",
    ...edgeRows,
    "",
    ...claimBlocks,
    "",
    "## 投资含义与重点观察",
    "",
    "| 对象/环节 | 当前判断 | 关键依据 | 后续观察 | 主要风险 |",
    "|---|---|---|---|---|",
    `| 研究对象 | ${input.executivePoints[0] || "边界内复述"} | 已确认判断 | 跟踪改判条件 | 证据不足外推 |`,
    "",
    "## 催化、验证与风险",
    "",
    "### 未来重点观察",
    "",
    "| 时间或频率 | 指标/事件 | 当前基线 | 触发条件 | 对判断的影响 | 首选来源 |",
    "|---|---|---|---|---|---|",
    "| 下一披露窗口 | 关键公开指标 | 待补 | 连续两期同向变化 | 增强 / 削弱 / 改判 | 公司披露/行业数据 |",
    "",
    "### 主要风险",
    "",
    ...(input.limitations.length
      ? input.limitations.map((item) => `- ${item}`)
      : ["- 公开材料不足以支撑方向判断。"]),
    "",
    "## 主要资料来源",
    "",
    ...(input.sourceLines.length
      ? input.sourceLines.map((line) => `- ${line}`)
      : ["- 当前无已绑定可点击来源；若为不可判断路径，请保持边界表述。"]),
    "",
    "## 口径说明与合规声明",
    "",
    "- 本报告用于内部研究讨论，不构成证券评级、收益承诺或交易操作建议。",
    "- 正式表达不得抬高 04 结论强度；配对审计见 expression_audit_yaml。",
  ].join("\n");
}

// =============================================================================
// v2 增强: 跨阶段引用完整性检查
// =============================================================================

/**
 * 检查 05 expressions 是否全部映射到 04 claims
 * 对标 governance/validate_publish.py 05_to_04 引用完整性
 */
export function checkExpressClaimMapping(
  expressions: any[],
  stage04Claims: any[],
): { missingMappings: string[]; passed: boolean } {
  const claimIds = new Set(stage04Claims.map((c) => String(c.id || c.claim_id || "")));
  const missingMappings: string[] = [];

  for (const expression of expressions) {
    const expressionId = String(expression.id || expression.expression_id || "");
    const claimRef = String(expression.claim_id || expression.claim_ref || "");
    if (!claimRef) {
      missingMappings.push(`EX ${expressionId}: 缺少 claim_ref`);
    } else if (!claimIds.has(claimRef)) {
      missingMappings.push(`EX ${expressionId}: claim_ref="${claimRef}" 在 04 claims 中不存在`);
    }
  }

  return {
    missingMappings,
    passed: missingMappings.length === 0,
  };
}

/**
 * 检查 05 source_lines 中的引用是否可追溯到 03 sources
 */
export function checkSourceLineReferences(
  sourceLines: any[],
  stage03Sources: any[],
): { brokenRefs: string[]; passed: boolean } {
  const sourceIds = new Set(stage03Sources.map((s) => String(s.id || "")));
  const brokenRefs: string[] = [];

  for (const line of sourceLines) {
    const sourceRef = String(line.source_ref || line.source_id || "");
    if (sourceRef && !sourceIds.has(sourceRef)) {
      brokenRefs.push(`source_ref="${sourceRef}" 在 03 sources 中不存在`);
    }
  }

  return {
    brokenRefs,
    passed: brokenRefs.length === 0,
  };
}

/**
 * 检查 05 表达强度是否超过 04 判断等级
 * 对标 governance/validate_publish.py "05 表达超过 04 审计边界"
 */
export type ExpressionBoundaryViolation = {
  expressionId: string;
  claimId: string;
  claimLevel: string;
  violation: string;
  suggestion: string;
};

export function checkExpressionBoundaries(
  expressions: any[],
  stage04Claims: any[],
  stage04Judgments: any[],
): ExpressionBoundaryViolation[] {
  const violations: ExpressionBoundaryViolation[] = [];
  const claimMap = new Map(stage04Claims.map((c) => [String(c.id || c.claim_id || ""), c]));
  const judgmentMap = new Map(stage04Judgments.map((j) => [String(j.id || j.judgment_id || ""), j]));

  // 从 evidence_quality_gate 导入判断等级上限
  const J_RANK: Record<string, number> = { J0: 0, J1: 1, J2: 2, J3: 3, J4: 4 };
  const EXPRESSION_STRENGTH_KEYWORDS: Record<number, string[]> = {
    3: ["确认", "确定", "已确认", "明确"],
    4: ["目标价", "评级", "买入", "卖出"],
  };

  for (const expression of expressions) {
    const expressionId = String(expression.id || expression.expression_id || "");
    const claimRef = String(expression.claim_id || expression.claim_ref || "");
    const text = String(expression.text || expression.content || expression.body || "");

    const claim = claimMap.get(claimRef);
    if (!claim) continue;

    const judgmentRef = String(claim.judgment_id || claim.judgment_ref || "");
    const judgment = judgmentMap.get(judgmentRef);
    const claimLevel = String(judgment?.strength || "J0");
    const claimRank = J_RANK[claimLevel] || 0;

    // 检查是否存在越级关键词
    for (const [minRank, keywords] of Object.entries(EXPRESSION_STRENGTH_KEYWORDS)) {
      if (claimRank < Number(minRank)) {
        for (const keyword of keywords) {
          if (text.includes(keyword)) {
            violations.push({
              expressionId,
              claimId: claimRef,
              claimLevel,
              violation: `EX ${expressionId} (claim=${claimRef}, J${claimLevel.slice(1)}) 包含 ${keyword}，超过许可强度`,
              suggestion: `移除/替换越级关键词，或降低 Claim ${claimRef} 对应的判断强度`,
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * 跨阶段完整性综合检查 — 返回所有 violation
 */
export function runCrossStageIntegrityChecks(
  stage05Data: {
    expressions?: any[];
    source_lines?: any[];
    body?: string;
  },
  stage04Data: {
    claims?: any[];
    judgments?: any[];
  },
  stage03Data: {
    sources?: any[];
  },
): {
  exClaimMapping: { missingMappings: string[]; passed: boolean };
  sourceRefs: { brokenRefs: string[]; passed: boolean };
  expressionBoundaries: ExpressionBoundaryViolation[];
  passed: boolean;
  summary: string;
} {
  const exClaimMapping = checkExpressClaimMapping(
    stage05Data.expressions || [],
    stage04Data.claims || [],
  );
  const sourceRefs = checkSourceLineReferences(
    stage05Data.source_lines || [],
    stage03Data.sources || [],
  );
  const expressionBoundaries = checkExpressionBoundaries(
    stage05Data.expressions || [],
    stage04Data.claims || [],
    stage04Data.judgments || [],
  );

  const issues: string[] = [];
  if (!exClaimMapping.passed) {
    issues.push(`${exClaimMapping.missingMappings.length} 条 EX→C 映射缺失`);
  }
  if (!sourceRefs.passed) {
    issues.push(`${sourceRefs.brokenRefs.length} 条来源引用断裂`);
  }
  if (expressionBoundaries.length > 0) {
    issues.push(`${expressionBoundaries.length} 条表达越界`);
  }

  return {
    exClaimMapping,
    sourceRefs,
    expressionBoundaries,
    passed: exClaimMapping.passed && sourceRefs.passed && expressionBoundaries.length === 0,
    summary: issues.length > 0
      ? `跨阶段完整性检查失败: ${issues.join("; ")}`
      : "跨阶段引用完整性通过",
  };
}
