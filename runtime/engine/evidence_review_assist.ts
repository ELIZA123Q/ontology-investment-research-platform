import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { ResearchWorkItem, SourceRecord } from "./types";
import { stripInternalReferencePrefix } from "./research_overview";

export type EvidenceReviewSuggestion = {
  evidence_id: string;
  suggestion: "accept_evidence" | "accept_gap" | "rework" | "review_manually";
  confidence: "high" | "medium" | "low";
  note: string;
  reasons: string[];
};

type EvidenceDraftLike = {
  id: string;
  statement: string;
  kind: string;
  direction?: string;
  directness?: string;
  source_ids?: string[];
  judgment_unit_ids?: string[];
  limitations?: string[];
  requirement?: string;
  evidence_role?: string;
  minimum_independent_sources?: number;
};

export type EvidenceGapPriority = {
  evidence_id: string;
  tier: "blocking" | "limiting" | "supplementary";
  label: "阻断主判断" | "限制判断强度" | "补充完善";
  statement: string;
  reason: string;
  score: number;
};

export function prioritizeEvidenceGaps(input: {
  evidence: EvidenceDraftLike[];
  workItems: Array<{ target_id: string; status: string }>;
}): EvidenceGapPriority[] {
  const workByTarget = new Map(input.workItems.map((item) => [item.target_id, item]));

  return input.evidence
    .filter((item) => item.kind === "gap" || item.kind === "conflict")
    .map((item) => {
      const unitCount = item.judgment_unit_ids?.length || 0;
      const workItem = workByTarget.get(item.id);
      const unresolved = !workItem || ["pending", "rework"].includes(workItem.status);
      const sourceRequirement = Number.isFinite(item.minimum_independent_sources)
        ? Number(item.minimum_independent_sources)
        : 0;
      const tier = unitCount > 0
        ? "blocking" as const
        : item.kind === "conflict"
          ? "limiting" as const
          : "supplementary" as const;
      const label = tier === "blocking"
        ? "阻断主判断" as const
        : tier === "limiting"
          ? "限制判断强度" as const
          : "补充完善" as const;
      const score = (unresolved ? 40 : 0)
        + (item.kind === "conflict" ? 30 : 20)
        + unitCount * 8
        + sourceRequirement * 4
        + (item.evidence_role === "counter" ? 6 : item.evidence_role === "support" ? 5 : 0);
      const statusNote = unresolved ? "尚未完成审阅" : "审阅虽已结束，但证据约束仍然存在";
      const reason = tier === "blocking"
        ? `${statusNote}；它直接对应 ${unitCount} 个判断单元，补证前相关结论必须保持暂不可判断。`
        : tier === "limiting"
          ? `${statusNote}；该冲突会限制结论强度，需要保留争议边界。`
          : `${statusNote}；它暂未绑定具体判断单元，可在主判断之后补充。`;

      return {
        evidence_id: item.id,
        tier,
        label,
        statement: stripInternalReferencePrefix(item.requirement || item.statement),
        reason,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.evidence_id.localeCompare(b.evidence_id));
}

function isUsableSource(source: SourceRecord) {
  return source.usability_status === "usable"
    && source.retrieval_status === "captured"
    && Boolean(source.quote_verified);
}

function padNote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 8) return trimmed;
  return `${trimmed}；已按规则预检。`.slice(0, 240);
}

export function buildEvidenceReviewSuggestions(input: {
  evidence: EvidenceDraftLike[];
  sources: SourceRecord[];
  workItems: ResearchWorkItem[];
  cutoffMs?: number;
  requirements?: EvidenceRequirementProjection[];
}): EvidenceReviewSuggestion[] {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const workByTarget = new Map(
    input.workItems
      .filter((item) => ["evidence_review", "supplement_evidence", "resolve_conflict"].includes(item.kind))
      .map((item) => [item.target_id, item]),
  );
  const requirements = input.requirements || [];

  return input.evidence.map((draft) => {
    const reasons: string[] = [];
    const workItem = workByTarget.get(draft.id);
    if (workItem && ["approved", "dismissed", "superseded"].includes(workItem.status)) {
      return {
        evidence_id: draft.id,
        suggestion: "review_manually",
        confidence: "low",
        note: padNote(`该条目审阅已结束（${workItem.status}），如需改变结论请重新生成稿件。`),
        reasons: ["审阅已终态"],
      };
    }

    if (draft.kind === "gap") {
      const note = padNote(
        `接受当前证据缺口：${draft.requirement || draft.statement}；结论须保持暂不可判断，不得外推为已证实事实。`,
      );
      return {
        evidence_id: draft.id,
        suggestion: "accept_gap",
        confidence: "high",
        note,
        reasons: ["缺口条目无来源绑定，只能记录接受缺口"],
      };
    }

    if (draft.kind === "conflict") {
      return {
        evidence_id: draft.id,
        suggestion: "review_manually",
        confidence: "low",
        note: padNote("冲突证据需人工判断哪条可用、是否退回补证或维持争议状态。"),
        reasons: ["冲突车道不自动建议确认"],
      };
    }

    const boundSources = (draft.source_ids || [])
      .map((id) => sourceById.get(id))
      .filter((source): source is SourceRecord => Boolean(source));

    if (!boundSources.length) {
      return {
        evidence_id: draft.id,
        suggestion: "rework",
        confidence: "high",
        note: padNote("无绑定来源，不能确认事实；可补充取证、改为缺口，或退回补证。"),
        reasons: ["非缺口条目缺少来源"],
      };
    }

    let confidence: "high" | "medium" | "low" = "high";
    const usableSources = boundSources.filter((source) => isUsableSource(source));
    const hardFailures: string[] = [];

    for (const source of boundSources) {
      if (!isUsableSource(source)) {
        const reason = `来源 ${source.title} 未满足可用/已抓取/引文已核验`;
        if (source.retrieval_status === "failed" || !source.quote_verified) hardFailures.push(reason);
      }
      if (source.retrieval_status === "failed") {
        hardFailures.push(`来源 ${source.title} 抓取失败`);
      }
      if (!source.quote_verified) {
        hardFailures.push(`来源 ${source.title} 逐字引用未核验`);
      }
      if (Number.isFinite(input.cutoffMs) && source.published_at && Date.parse(String(source.published_at)) > input.cutoffMs!) {
        hardFailures.push(`来源 ${source.title} 发布日晚于研究截止时间`);
      }
    }

    if (!usableSources.length && hardFailures.length) {
      return {
        evidence_id: draft.id,
        suggestion: "review_manually",
        confidence: "medium",
        note: padNote(`来源尚未全部核验可用，可点「补充取证」继续补证，或接受为缺口；${[...new Set(hardFailures)].join("；")}`),
        reasons: [...new Set(hardFailures)],
      };
    }

    if (usableSources.length && hardFailures.length) {
      confidence = "medium";
      reasons.push(...[...new Set(hardFailures)]);
    }

    if (!(draft.limitations || []).length) {
      reasons.push("未登记局限");
      confidence = "medium";
    }

    const sourceGroups = new Set(boundSources.map((source) => source.source_group || source.publisher || source.normalized_url));
    const unitRequirements = requirements.filter((item) =>
      (draft.judgment_unit_ids || []).some((unitId) => item.judgment_unit_ids.includes(unitId)),
    );
    const minIndependent = unitRequirements.length
      ? Math.max(...unitRequirements.map((item) => item.minimum_independent_sources))
      : 1;
    if (sourceGroups.size < minIndependent) {
      reasons.push(`独立来源组 ${sourceGroups.size} 个，低于要求 ${minIndependent} 个`);
      confidence = "medium";
    }

    if (reasons.length && confidence !== "high") {
      return {
        evidence_id: draft.id,
        suggestion: "review_manually",
        confidence,
        note: padNote(`需人工复核：${reasons.join("；")}`),
        reasons,
      };
    }

    if (reasons.length) {
      return {
        evidence_id: draft.id,
        suggestion: "review_manually",
        confidence: "medium",
        note: padNote(`存在提醒项：${reasons.join("；")}`),
        reasons,
      };
    }

    const sourceSummary = boundSources.map((source) => `${source.title}（${source.authority_type || "unknown"}）`).join("、");
    return {
      evidence_id: draft.id,
      suggestion: "accept_evidence",
      confidence: "high",
      note: padNote(`来源已核验可用（${sourceSummary}）；局限：${(draft.limitations || []).join("；") || "无额外局限"}`),
      reasons: ["来源可用且未触发独立性/截止日告警"],
    };
  });
}

export function suggestionToDecision(suggestion: EvidenceReviewSuggestion, kind: string): {
  status: "approved" | "rework" | "dismissed";
  resolution: string;
} | null {
  if (suggestion.suggestion === "accept_evidence") {
    return { status: "approved", resolution: "accepted_evidence" };
  }
  if (suggestion.suggestion === "accept_gap" && kind === "gap") {
    return { status: "approved", resolution: "accepted_evidence_gap" };
  }
  if (suggestion.suggestion === "rework") {
    return { status: "rework", resolution: "rework_requested" };
  }
  return null;
}
