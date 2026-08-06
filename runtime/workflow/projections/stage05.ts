import { createHash } from "node:crypto";
import "server-only";
import {
createArtifact,
getRun,
latestArtifact,
listSources
} from "../../storage/db";
import { PROMPT_VERSION } from "../../agents/shared/prompts_source";
import { schemas } from "../../schemas/schemas";
import { parseJson,type SourceRecord } from "../../schemas/types";

import { ensureStage05DocumentFields } from "../../agents/05_delivery/input_contract";
import { isReadableEvidenceText } from "../../skills/expression_audit/text_quality";
import {
buildStage05SkeletonMarkdown,
shouldPreserveStage05Markdown,
stripInlineAuditDetails,
} from "../../agents/05_delivery/quality_gate";
import {
editArtifact
} from "../shared";

export function normalizeStage05Projection(
  data: any,
  stage04: any,
  question: string,
  sources: SourceRecord[],
  options: { forceDeterministicSkeleton?: boolean } = {},
) {
  const judgmentById = new Map<string, any>((stage04.judgments || []).map((item: any) => [String(item.id), item]));
  const methodStatusById = new Map<string, string>(
    (stage04.method_applications || []).map((item: any) => [
      String(item.application_id || item.id || ""),
      String(item.status || ""),
    ]),
  );
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const claim of data.report_claims || []) {
    const judgments = (claim.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean);
    if (!judgments.length) throw new Error(`${claim.id} 无法从已确认 Judgment 重建表达`);
    if (methodStatusById.size) {
      // Stage04 可保留 degraded/blocked 方法作为研究过程审计，但 Stage05 只能把
      // 实际 executed 的方法列为报告依据，禁止“方法被路由过”冒充“方法已执行”。
      claim.method_application_ids = [...new Set(
        judgments
          .flatMap((judgment: any) => judgment.method_application_ids || [])
          .map(String)
          .filter((id: string) => methodStatusById.get(id) === "executed"),
      )];
      if (!claim.method_application_ids.length) {
        throw new Error(`${claim.id} 没有可用于正式表达的 executed MethodApplication`);
      }
    }
    // 结构化 statement 对齐判断卡；强度编码仅留在字段/审计，不写入读者标题。
    claim.statement = judgments.map((judgment: any) =>
      `${judgment.title}：${judgment.conclusion}`).join("；");
  }

  const derivedPoints = (data.report_claims || []).flatMap((claim: any) =>
    (claim.judgment_ids || []).map((id: string) => {
      const judgment = judgmentById.get(String(id));
      return judgment ? `${judgment.title}：${judgment.conclusion}` : claim.statement;
    }));
  const derivedLimitations = [...new Set([
    String(stage04.overall_boundary || "").trim(),
    ...(stage04.judgments || []).flatMap((judgment: any) => [
      ...(judgment.uncertainties || []),
      ...(judgment.invalidation_conditions || []).map((item: string) => `改判条件：${item}`),
    ]),
  ].filter(Boolean))];

  const existingBody = stripInlineAuditDetails(String(data.document_markdown || ""));
  const preserve = !options.forceDeterministicSkeleton && shouldPreserveStage05Markdown(existingBody);

  // 压平/重建路径：要点与边界必须来自已确认判断，丢弃自由正文越权主张。
  if (!preserve) {
    data.executive_points = derivedPoints;
    data.limitations = derivedLimitations;
  } else {
    if (!Array.isArray(data.executive_points) || !data.executive_points.length) {
      data.executive_points = derivedPoints;
    }
    if (!Array.isArray(data.limitations) || !data.limitations.length) {
      data.limitations = derivedLimitations;
    }
  }
  if (!String(data.title || "").trim() || String(data.title).includes("研究判断简报")) {
    const primary = (stage04.judgments || [])[0];
    data.title = primary?.conclusion
      ? String(primary.conclusion).replace(/\s+/g, " ").trim().slice(0, 80)
      : String(question || "行业周期判断").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  const usedSourceIds = new Set<string>((data.report_claims || []).flatMap((claim: any) => claim.source_ids || []).map(String));
  const usedSources = [...usedSourceIds].map((id) => sourceById.get(id)).filter(Boolean) as SourceRecord[];
  const sourceLines = usedSources.map((source) => `[${source.title}](${source.url})`);

  if (preserve) {
    data.document_markdown = existingBody;
  } else {
    // 重建骨架时丢弃自由叙述标题/要点/限制，只保留判断卡派生内容，防止过声称进入正文。
    const primary = (stage04.judgments || [])[0];
    data.title = primary?.conclusion
      ? String(primary.conclusion).replace(/\s+/g, " ").trim().slice(0, 80)
      : String(question || "行业周期判断").replace(/\s+/g, " ").trim().slice(0, 80);
    data.executive_points = derivedPoints;
    data.limitations = derivedLimitations;
    data.document_markdown = buildStage05SkeletonMarkdown({
      title: data.title,
      question,
      executivePoints: data.executive_points,
      limitations: data.limitations,
      sourceLines,
      claims: (data.report_claims || []).map((claim: any) => {
        const judgments = (claim.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean);
        const claimSources = (claim.source_ids || []).map((id: string) => sourceById.get(String(id))).filter(Boolean) as SourceRecord[];
        return {
          id: String(claim.id),
          statement: String(claim.statement || ""),
          judgmentTitles: judgments.map((judgment: any) => judgment.title).filter(Boolean),
          conclusions: judgments.map((judgment: any) => judgment.conclusion).filter(Boolean),
          sourceLines: claimSources.map((source) => {
            const rawQuote = String(source.source_quote || "").replace(/\s+/g, " ").trim();
            const quote = isReadableEvidenceText(rawQuote) ? rawQuote : "";
            const excerpt = quote.length > 500 ? `${quote.slice(0, 500)}…` : quote;
            return `[${source.title}](${source.url})${excerpt ? `：“${excerpt}”` : ""}`;
          }),
          uncertainties: [...new Set(judgments.flatMap((judgment: any) => judgment.uncertainties || []).map(String).filter(Boolean))],
          invalidations: [...new Set(judgments.flatMap((judgment: any) => judgment.invalidation_conditions || []).map(String).filter(Boolean))],
        };
      }),
    });
  }

  // 强制刷新审计投影，确保与 claim 对齐且不含读者面审计腔。
  data.expression_audit_yaml = "";
  ensureStage05DocumentFields(data, { question, stage04 });
  return data;
}

export function createStage05DeterministicProjection(runId: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const stage04Artifact = latestArtifact(runId, "stage_04", ["approved"]);
  const sourceArtifact = latestArtifact(runId, "stage_05", ["approved", "needs_review"]);
  const stage03Artifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!stage04Artifact || !stage03Artifact) throw new Error("请先生成并确认 Stage 03 和 Stage 04");
  const stage04 = parseJson<any>(stage04Artifact.json_content, {});
  const stage03 = parseJson<any>(stage03Artifact.json_content, {});
  const evidenceById = new Map<string, any>((stage03.evidence_drafts || []).map((item: any) => [String(item.id), item]));
  const seed = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {
    title: "受控表达草稿",
    executive_points: [],
    report_claims: (stage04.judgments || []).map((judgment: any, index: number) => {
      const evidenceIds = [...new Set([
        ...(judgment.supporting_evidence_draft_ids || []),
        ...(judgment.counter_evidence_draft_ids || []),
      ].map(String))];
      const sourceIds = [...new Set(evidenceIds.flatMap((id) => evidenceById.get(id)?.source_ids || []).map(String))];
      return {
        id: `RC-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
        statement: String(judgment.conclusion || judgment.title || judgment.id),
        judgment_ids: [String(judgment.id)],
        method_application_ids: [...new Set((judgment.method_application_ids || []).map(String))],
        evidence_draft_ids: evidenceIds,
        source_ids: sourceIds,
      };
    }),
    limitations: [],
    document_markdown: "placeholder",
  };
  // 确定性路径显式生成 05C 骨架草稿；不得当作抹掉模型研报的默认正式路径。
  const data = normalizeStage05Projection(
    seed,
    stage04,
    run.question,
    listSources(runId),
    { forceDeterministicSkeleton: true },
  );
  schemas.stage_05.parse(data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  return createArtifact(runId, "stage_05", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:runtime-deterministic-expression-v1`,
    knowledge_version: "runtime-deterministic-expression-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_03_artifact_id: stage03Artifact.id,
      stage_03_artifact_hash: createHash("sha256").update(stage03Artifact.json_content).digest("hex"),
      stage_04_artifact_id: stage04Artifact.id,
      stage_04_artifact_hash: createHash("sha256").update(stage04Artifact.json_content).digest("hex"),
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-expression-projection",
    tool_usage: JSON.stringify({ deterministic_projection: true, report_claim_count: data.report_claims.length }),
  });
}
