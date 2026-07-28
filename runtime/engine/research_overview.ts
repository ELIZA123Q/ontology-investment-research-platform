import type { ResearchWorkItem } from "./types";
import { RESEARCH_STAGE_JOURNEY, researchStageByKind } from "@/app/lib/research-journey";

type JudgmentLike = {
  id?: string;
  strength?: string;
  level?: string;
  conclusion?: string;
  statement?: string;
  uncertainties?: string[];
  rationale?: string;
};

type EvidenceLike = {
  kind?: string;
};

type WorkItemLike = Pick<ResearchWorkItem, "stage" | "title" | "reason" | "priority">;

export type ResearchOverview = {
  headline: string;
  explanation: string;
  strongestJudgment?: JudgmentLike;
  primaryAction: {
    eyebrow: string;
    title: string;
    description: string;
    href: string;
    cta?: string;
  };
};

const strengthRank: Record<string, number> = { J0: 0, J1: 1, J2: 2, J3: 3 };
const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

const NEXT_STAGE_TITLES = [
  "先把问题收敛为可证伪任务",
  "确认判断单元与必要证据",
  "围绕判断单元准备证据",
  "裁决结论强度与失效边界",
  "把获准判断表达为报告",
] as const;

export function stripInternalReferencePrefix(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/^(?:(?:ER|EV|JU|GAP|CE|CD|RQ|Q)-[A-Za-z0-9._-]+\s*[:：]\s*)+/i, "")
    .replace(/\b(?:ER|EV|JU|GAP|CE|CD|RQ|Q)-[A-Za-z0-9._-]+\s*[:：]\s*/gi, "")
    .trim();
}

export function workItemHref(stage: string, runId: string): string {
  const journey = researchStageByKind(stage);
  if (journey) return `/runs/${runId}${journey.reviewPath}`;
  return `/runs/${runId}/scope`;
}

function stageNavLabel(kind: string): string {
  return researchStageByKind(kind)?.navLabel || "当前阶段";
}

function nextStage(currentStage: number, runId: string) {
  const index = Math.min(Math.max(currentStage, 0), 4);
  const target = RESEARCH_STAGE_JOURNEY[index];
  // 主动作落在日常审阅场景；尚无产物时各审阅页会自行转到生成/编辑页。
  const href = currentStage <= 0
    ? `/runs/${runId}/stages/1`
    : `/runs/${runId}${target.reviewPath}`;
  return {
    eyebrow: `运行到下一个确认点 · ${target.navLabel}`,
    title: NEXT_STAGE_TITLES[index],
    description: "进入对应工作场景；需要生成或补来源时，再用页内次级入口。",
    href,
  };
}

export function buildResearchOverview(input: {
  runId: string;
  currentStage: number;
  pending: WorkItemLike[];
  awaitingReviewStage?: string;
  deliveryReady: boolean;
  judgments: JudgmentLike[];
  evidence: EvidenceLike[];
}): ResearchOverview {
  const pending = [...input.pending].sort((a, b) =>
    (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0),
  );
  const topPending = pending[0];
  const primaryAction = topPending
    ? {
      eyebrow: "处理待核对事项",
      title: stripInternalReferencePrefix(topPending.title) || "继续人工确认",
      description: stripInternalReferencePrefix(topPending.reason) || "完成这项确认后，研究流程才能继续。",
      href: workItemHref(topPending.stage, input.runId),
      cta: "去处理 →",
    }
    : input.awaitingReviewStage
      ? {
        eyebrow: "等待人工确认",
        title: `检查${stageNavLabel(input.awaitingReviewStage)}草稿`,
        description: "AI 已完成本阶段；确认或退回后才会继续下一阶段。",
        href: workItemHref(input.awaitingReviewStage, input.runId),
        cta: "去确认 →",
      }
    : input.currentStage < 5
      ? nextStage(input.currentStage, input.runId)
      : input.deliveryReady
        ? {
          eyebrow: "交付已就绪",
          title: "检查报告并导出交付",
          description: "报告与独立审阅已齐备；同证据基线与 A/B 为可选质量实验。",
          href: `/runs/${input.runId}/report`,
          cta: "查看 →",
        }
        : {
          eyebrow: "完成交付准备",
          title: "检查交付条件",
          description: "查看尚未满足的报告确认、独立审阅或待办条件。",
          href: `/runs/${input.runId}/report`,
          cta: "查看 →",
        };

  if (!input.judgments.length) {
    return {
      headline: "尚未形成正式判断",
      explanation: "先确认研究结构与必要证据，再由判断阶段裁决结论强度。",
      primaryAction,
    };
  }

  const ranked = [...input.judgments].sort((a, b) => {
    const aStrength = String(a.strength || a.level || "J0");
    const bStrength = String(b.strength || b.level || "J0");
    return (strengthRank[bStrength] || 0) - (strengthRank[aStrength] || 0);
  });
  const strongestJudgment = ranked[0];
  const allJ0 = ranked.every((item) => String(item.strength || item.level || "J0") === "J0");
  const gapCount = input.evidence.filter((item) => item.kind === "gap" || item.kind === "conflict").length;

  if (allJ0) {
    return {
      headline: "当前证据不足，暂不形成方向判断",
      explanation: `${ranked.length} 个判断单元均停在暂不可判断；${gapCount} 个相互矛盾或尚缺的证据仍约束结论强度。`,
      strongestJudgment,
      primaryAction,
    };
  }

  return {
    headline: stripInternalReferencePrefix(strongestJudgment?.conclusion || strongestJudgment?.statement) || "已形成阶段性判断",
    explanation: `当前最高判断强度为 ${String(strongestJudgment?.strength || strongestJudgment?.level || "J0")}；仍有 ${gapCount} 个相互矛盾或尚缺的证据需要纳入边界。`,
    strongestJudgment,
    primaryAction,
  };
}
