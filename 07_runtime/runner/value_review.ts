/**
 * 00A 五条研究价值半自动审查：启发式必跑；可选同一模型打分；失败可触发一次重试。
 * 不替代人审 / semantic_review；结果写入 Stage05 research_value_review + 表达审计。
 */

import { z } from "zod";
import {
  collectStage05HighQualityIssues,
  hasPublishableStage05Structure,
  isPlaceholderResearchEdge,
} from "../agents/05_delivery/quality_gate";

export const ZERO_A_CHECK_IDS = [
  "problem_not_swapped",
  "has_judgment_value",
  "evidence_not_overreach",
  "reader_usable",
  "no_forced_direction",
] as const;

export type ZeroACheckId = (typeof ZERO_A_CHECK_IDS)[number];

export type ResearchValueCheck = {
  id: ZeroACheckId | string;
  pass: boolean;
  score: number;
  evidence_span: string;
  note: string;
};

export type ResearchValueReview = {
  status: "pass" | "fail" | "skipped";
  checks: ResearchValueCheck[];
  retry_count: number;
  total_score: number;
  pass_threshold: number;
  reviewed_at?: string;
  mode: "heuristic" | "llm" | "combined";
  reviewer_model?: string;
  producer_model?: string;
};

export const researchValueReviewSchema = z.object({
  status: z.enum(["pass", "fail"]),
  checks: z.array(z.object({
    id: z.string(),
    pass: z.boolean(),
    score: z.number().int().min(0).max(4),
    evidence_span: z.string().default(""),
    note: z.string().default(""),
  })).min(5),
});

export const RESEARCH_VALUE_PASS_THRESHOLD = 16;

function nonEmpty(value: unknown): string {
  return String(value ?? "").trim();
}

function keywordsFromQuestion(question: string): string[] {
  const text = nonEmpty(question);
  if (!text) return [];
  const chunks = text
    .replaceAll("/", " ")
    .replaceAll("|", " ")
    .split(/[，。？?、；;：:\s（）()]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const latin = text.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) || [];
  const cjkChars = [...text].filter((ch) => /[\u4e00-\u9fff]/.test(ch));
  const ngrams: string[] = [];
  for (let n = 4; n >= 2; n -= 1) {
    for (let i = 0; i <= cjkChars.length - n; i += 1) {
      ngrams.push(cjkChars.slice(i, i + n).join(""));
    }
  }
  const ranked = [...new Set([...chunks, ...ngrams, ...latin])]
    .sort((a, b) => b.length - a.length);
  return ranked.slice(0, 40);
}

/** 确定性启发式：把 00A 可形式化子集落成可测检查。 */
export function heuristicResearchValueReview(input: {
  body: string;
  stage01?: any;
  research_edge?: Array<Record<string, unknown>>;
  intensity_lifted?: boolean;
  retry_count?: number;
}): ResearchValueReview {
  const body = nonEmpty(input.body);
  const question = nonEmpty(
    input.stage01?.normalized_question
    || input.stage01?.research_value_gate?.incremental_question
    || "",
  );
  const checks: ResearchValueCheck[] = [];

  const kws = keywordsFromQuestion(question);
  const hitKw = kws.filter((kw) => body.includes(kw));
  const strongHits = hitKw.filter((kw) => kw.length >= 3);
  checks.push({
    id: "problem_not_swapped",
    score: !question
      ? 1
      : strongHits.length >= 2
        ? 4
        : strongHits.length >= 1 || hitKw.length >= 2 || (question.length >= 4 && body.includes(question.slice(0, 8)))
          ? 3
          : 0,
    pass: Boolean(question) && (
      strongHits.length >= 1
      || hitKw.length >= 2
      || (question.length >= 4 && body.includes(question.slice(0, 8)))
    ),
    evidence_span: hitKw.slice(0, 4).join("、") || question.slice(0, 40),
    note: !question
      ? "缺少 Stage01 归一化问题，跳过严格比对"
      : hitKw.length
        ? "正文覆盖任务关键词"
        : "正文未明显覆盖 01 研究对象/问题关键词",
  });

  const edges = Array.isArray(input.research_edge) ? input.research_edge : [];
  const substantive = edges.some((edge) => !isPlaceholderResearchEdge(edge as any));
  const hasEdgeSection = body.includes("Research Edge") || body.includes("市场认知差") || body.includes("认知差");
  const argumentChapters = (body.match(/^##\s+[一二三四五]、/gm) || []).length;
  const mechanismSignals = (body.match(/→|传导|驱动|导致|因此|机制|挤出|约束/g) || []).length;
  const sourceAnchors = (body.match(/https?:\/\/|material-refs:|source-annotation-refs:/g) || []).length;
  const competingSignals = (body.match(/竞争解释|反证|对立解释|备择解释|无法排除|仍可能/g) || []).length;
  const thinChapters = collectStage05HighQualityIssues({
    body,
    research_edge: edges,
    deterministic_check_status: "checked",
  }).some((item) => item.code === "argument_chapter_thin" || item.code === "argument_chapter_ungrounded");
  // 有节名/关键词但无实质 Research Edge、或论点章过薄 → 仍判无判断价值
  // 竞争解释/反证与实质 Edge、论点密度并列为硬信号；纯字数不单独给分。
  const judgmentValueScore = [
    hasEdgeSection && substantive,
    !thinChapters && argumentChapters >= 2,
    mechanismSignals >= 4,
    sourceAnchors >= 2,
    competingSignals >= 1,
  ].filter(Boolean).length;
  checks.push({
    id: "has_judgment_value",
    score: Math.min(4, judgmentValueScore),
    pass: judgmentValueScore >= 3 && substantive && !thinChapters,
    evidence_span: substantive && !thinChapters
      ? `research_edge + arguments + competing=${competingSignals}`
      : thinChapters
        ? "argument chapters thin"
        : !substantive
          ? "placeholder research edge"
          : hasEdgeSection
            ? "Research Edge section only"
            : "",
    note: substantive && !thinChapters && competingSignals >= 1
      ? "存在实质认知差、可审阅论点章与竞争解释/反证处理"
      : substantive && !thinChapters
        ? "有实质 Edge 与论点章，但竞争解释/反证表述偏弱"
        : thinChapters
          ? "论点章过薄或未 grounding，材料堆砌不等于判断价值"
          : "缺少实质 Research Edge（禁止仅靠关键词/节名交差）",
  });

  const overreach = Boolean(input.intensity_lifted)
    || /J[34]\s*已确认|确定性见顶|必须买入|目标价/.test(body);
  const hasBoundaryLanguage = /边界|口径|不能外推|不可外推|证据不足|样本|限制|条件/.test(body);
  checks.push({
    id: "evidence_not_overreach",
    score: overreach ? 0 : hasBoundaryLanguage ? 4 : 3,
    pass: !overreach,
    evidence_span: overreach ? "检测到强度抬升或越权表达" : "未见明显越权",
    note: overreach ? "疑似超过证据可支持强度" : "未见明显越权措辞",
  });

  const usableSignals = [
    hasPublishableStage05Structure(body),
    body.includes("当前基线") && body.includes("触发条件"),
    /##\s*投资含义/.test(body) && body.length >= 4_000,
    body.includes("投资要点") && body.length >= 5_000,
  ].filter(Boolean).length;
  const usable = usableSignals >= 3;
  checks.push({
    id: "reader_usable",
    score: usableSignals,
    pass: usable,
    evidence_span: usable ? "固定节+跟踪表" : "结构或跟踪表不足",
    note: usable ? "读者可直接看到判断、依据与跟踪" : "缺少可执行跟踪或固定节",
  });

  const hqThin = collectStage05HighQualityIssues({
    body,
    research_edge: edges,
    deterministic_check_status: "checked",
  }).some((item) => item.code === "argument_chapter_thin" || item.code === "argument_chapter_ungrounded");
  const actionableAdvice =
    /配置上|仓位建议|目标价|买入评级|卖出评级|投资者(?:需|应)|应警惕[^。；\n]{0,24}(?:公司|厂商|标的)|(?:估值|板块)[^。；\n]{0,32}(?:溢价|见顶风险)/.test(body);
  const forcedDirection = actionableAdvice || (hqThin && /全面看多|确定反转|周期已结束/.test(body));
  const honestGap = /暂不可判断|证据不足|缺口|验证窗口|方向性解释/.test(body);
  checks.push({
    id: "no_forced_direction",
    score: actionableAdvice ? 0 : forcedDirection && !honestGap ? 0 : honestGap ? 4 : 3,
    pass: !actionableAdvice && (!forcedDirection || honestGap),
    evidence_span: actionableAdvice ? "出现配置/评级/投资者行动或个股估值式建议" : forcedDirection ? "薄弱论证+强方向" : honestGap ? "有边界/缺口表述" : "未见硬撑",
    note: actionableAdvice
      ? "免责声明不能抵消正文中的投资行动或个股估值建议"
      : forcedDirection && !honestGap
        ? "论证偏薄却给出强方向，疑似硬撑"
      : "未见明显硬撑方向",
  });

  const totalScore = checks.reduce((sum, item) => sum + item.score, 0);
  const failed = checks.filter((item) => !item.pass);
  return {
    status: failed.length || totalScore < RESEARCH_VALUE_PASS_THRESHOLD ? "fail" : "pass",
    checks,
    retry_count: input.retry_count ?? 0,
    total_score: totalScore,
    pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
    reviewed_at: new Date().toISOString(),
    mode: "heuristic",
  };
}

export function researchValueReviewPrompt(): string {
  return [
    "你是投研质量审查员。仅依据 00A 五条评估 Stage05 正文是否对研究员可用。",
    "五条：1 problem_not_swapped 2 has_judgment_value 3 evidence_not_overreach 4 reader_usable 5 no_forced_direction。",
    "每项按 0—4 分评分并给 pass、evidence_span（引用正文短片段）、note：0 缺失/相反，1 仅有形式，2 有内容但决策价值弱，3 研究员可用，4 有明确增量且可证伪。",
    "has_judgment_value 必须检查差异化观点、主导机制、竞争解释和证据—机制—含义链，不能因有 Research Edge 表格就给高分。",
    "reader_usable 必须检查研究员能否据此更新判断、知道看什么信号和何时改判，不能因章节齐全就给高分。",
    `status=pass 当且仅当五条全过且合计至少 ${RESEARCH_VALUE_PASS_THRESHOLD}/20。不得因文风偏好判 fail；不得要求买卖建议。`,
    "最终必须通过 submit 函数提交 JSON。",
  ].join("\n");
}

export function mergeResearchValueReviews(
  heuristic: ResearchValueReview,
  llm: ResearchValueReview | null,
): ResearchValueReview {
  if (!llm) return heuristic;
  const byId = new Map(heuristic.checks.map((item) => [item.id, item]));
  for (const check of llm.checks) {
    const prev = byId.get(check.id);
    // 任一模式 fail 则 fail（保守）。
    byId.set(check.id, {
      id: check.id,
      pass: Boolean(prev?.pass) && check.pass,
      score: Math.min(prev?.score ?? 0, check.score ?? 0),
      evidence_span: check.evidence_span || prev?.evidence_span || "",
      note: check.note || prev?.note || "",
    });
  }
  const checks = ZERO_A_CHECK_IDS.map((id) => byId.get(id) || {
    id,
    pass: false,
    score: 0,
    evidence_span: "",
    note: "缺失检查项",
  });
  const totalScore = checks.reduce((sum, item) => sum + item.score, 0);
  return {
    status: checks.every((item) => item.pass) && totalScore >= RESEARCH_VALUE_PASS_THRESHOLD ? "pass" : "fail",
    checks,
    retry_count: Math.max(heuristic.retry_count, llm.retry_count),
    total_score: totalScore,
    pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
    reviewed_at: new Date().toISOString(),
    mode: "combined",
    reviewer_model: llm.reviewer_model,
    producer_model: heuristic.producer_model || llm.producer_model,
  };
}

export function buildStage05RetryContext(review: ResearchValueReview): string {
  const failed = review.checks.filter((item) => !item.pass);
  return [
    "上一稿未通过 00A 研究价值审查，请只修正失败项，保持证据不越权、不新增无来源数字：",
    ...failed.map((item) => `- [${item.id}] ${item.note}${item.evidence_span ? `（依据：${item.evidence_span}）` : ""}`),
  ].join("\n");
}

export function attachResearchValueReview(data: any, review: ResearchValueReview): any {
  const next = data && typeof data === "object" ? data : {};
  next.research_value_review = review;
  if (review.status === "fail") {
    // 研究价值失败不是“较低档次但仍可交付”，而是必须返工。
    // 这样 compliance/结构检查无法覆盖实质价值失败。
    next.quality_status = "return_required";
    next.deterministic_check_status = "not_checked";
  }
  return next;
}
