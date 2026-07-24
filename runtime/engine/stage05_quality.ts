/**
 * Stage05 交付结构校验（对齐 governance validate_05_outputs.REQUIRED_FIXED_SECTIONS）。
 * 用于 Runtime 确认门禁；不替代完整 Python 发布包校验。
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
  return STAGE05_REQUIRED_FIXED_SECTIONS.every((section) => body.includes(`## ${section}`));
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

/** LLM/人工稿是否应保留（有研报节或论点章，且不是压平简报）。 */
export function shouldPreserveStage05Markdown(body: string): boolean {
  const text = nonEmpty(body);
  if (!text || text === "placeholder" || text.length < 80) return false;
  if (looksLikeFlattenedBrief(text)) return false;
  if (hasStage05FixedSections(text)) return true;
  if (countArgumentChapters(text) >= MIN_ARGUMENT_CHAPTERS && text.includes("## 投资要点")) return true;
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
    if (!text.includes(`## ${section}`)) {
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

  // 若只有 1 个 claim，补第二节以满足 2–5 论点章要求
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
