import { latestArtifact, listSources, updateArtifactIfStatus } from "../../adapters/db";
import {
  accumulateTokenUsage,
  createResearchModelClient,
  type ResearchModelClient,
} from "../../adapters/deepseek";
import { stripLegacyWriteFields, toExpressionAuditInputs } from "../artifact_read_adapter";
import { auditStage05Expressions, sanitizeAuditVoice } from "../expression_audit";
import { buildGenerationProgressHeartbeat } from "../generation_progress";
import {
  attachResearchValueReview,
  buildStage05RetryContext,
  heuristicResearchValueReview,
  mergeResearchValueReviews,
  RESEARCH_VALUE_PASS_THRESHOLD,
  researchValueReviewPrompt,
  researchValueReviewSchema,
  type ResearchValueReview,
} from "../research_value_review";
import { schemas } from "../schemas";
import { ensureStage05DocumentFields } from "../stage05_documents";
import { parseJson } from "../types";
import { normalizeStage05Projection } from "../workflow_projections";
import { validateGeneratedSemanticDraft } from "../workflow_shared";

function stage05PaidAutoRetryEnabled() {
  return ["1", "true", "yes"].includes(
    String(process.env.STAGE05_PAID_AUTO_RETRY || "").trim().toLowerCase(),
  );
}

export async function runStage05ResearchValueReview(input: {
  data: any;
  result: any;
  cumulativeUsage: any;
  lastHeartbeatJson: string;
  runId: string;
  run: { id: string; question: string };
  deliveryArchetype: string;
  taskContext: any;
  client: ResearchModelClient;
  systemPrompt: string;
  inputContext: string;
  artifact: { id: string };
  startedAt: string;
  assertRunning: () => void;
}) {
  let { data, result, cumulativeUsage, lastHeartbeatJson } = input;
  const {
    runId,
    run,
    deliveryArchetype,
    taskContext,
    client,
    systemPrompt,
    inputContext,
    artifact,
    startedAt,
    assertRunning,
  } = input;

  const judgmentArtifact = latestArtifact(runId, "stage_04", ["approved"])!;
  const judgmentJson = parseJson<any>(judgmentArtifact.json_content, {});
  // 对齐 claim↔judgment 与审计；保留模型研报正文，不压平为简报。
  normalizeStage05Projection(
    data,
    judgmentJson,
    run.question,
    listSources(runId),
  );
  if (!data.delivery_archetype) data.delivery_archetype = deliveryArchetype;
  
  let review: ResearchValueReview = heuristicResearchValueReview({
    body: String(data.document_markdown || ""),
    stage01: taskContext,
    research_edge: data.research_edge,
    intensity_lifted: false,
    retry_count: 0,
  });
  review.producer_model = client.model;
  // 研究价值用 reviewer 配置打分，避免生产模型自评。不可用时保留
  // 更保守的确定性启发式；reviewer 不参与改写正文。
  try {
    const valueReviewClient = createResearchModelClient("reviewer", "stage_05");
    const llmReview = await valueReviewClient.generateStructured(
      "research_value_review",
      researchValueReviewSchema,
      researchValueReviewPrompt(),
      JSON.stringify({
        question: run.question,
        stage01_normalized_question: taskContext?.normalized_question || null,
        document_markdown: String(data.document_markdown || "").slice(0, 24_000),
        research_edge: data.research_edge || [],
      }, null, 2),
      { maxToolRounds: 2 },
    );
    cumulativeUsage = accumulateTokenUsage(cumulativeUsage, llmReview.usage);
    const totalScore = llmReview.data.checks.reduce((sum, item) => sum + item.score, 0);
    review = {
      status: llmReview.data.status,
      checks: llmReview.data.checks,
      retry_count: 0,
      total_score: totalScore,
      pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
      reviewed_at: new Date().toISOString(),
      mode: "llm",
      reviewer_model: valueReviewClient.model,
      producer_model: client.model,
    };
    // 与启发式取交：任一 fail 则 fail
    const heuristic = heuristicResearchValueReview({
      body: String(data.document_markdown || ""),
      stage01: taskContext,
      research_edge: data.research_edge,
      retry_count: 0,
    });
    const byId = new Map(heuristic.checks.map((item) => [item.id, item]));
    for (const check of review.checks) {
      const prev = byId.get(check.id);
      byId.set(check.id, {
        id: check.id,
        pass: Boolean(prev?.pass) && check.pass,
        score: Math.min(prev?.score ?? 0, check.score ?? 0),
        evidence_span: check.evidence_span || prev?.evidence_span || "",
        note: check.note || prev?.note || "",
      });
    }
    review = {
      status: [...byId.values()].every((item) => item.pass)
        && [...byId.values()].reduce((sum, item) => sum + item.score, 0) >= RESEARCH_VALUE_PASS_THRESHOLD
        ? "pass"
        : "fail",
      checks: [...byId.values()],
      retry_count: 0,
      total_score: [...byId.values()].reduce((sum, item) => sum + item.score, 0),
      pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
      reviewed_at: new Date().toISOString(),
      mode: "combined",
      reviewer_model: valueReviewClient.model,
      producer_model: client.model,
    };
  } catch {
    // 模型审查不可用时仅用启发式
  }
  
  if (review.status === "fail" && stage05PaidAutoRetryEnabled()) {
    assertRunning();
    const retryInput = JSON.stringify({
      ...JSON.parse(inputContext),
      research_value_retry_notes: buildStage05RetryContext(review),
    }, null, 2);
    const retryResult = await client.generate("stage_05", systemPrompt, retryInput, {
      maxToolRounds: 4,
      runId,
      validateOutput: (draft) => validateGeneratedSemanticDraft(runId, "stage_05", draft),
      repairOutput: (draft) => ensureStage05DocumentFields(draft, {
        question: run.question,
        taskId: run.id,
        stage04: judgmentJson,
      }),
      onProgress: (event) => {
        assertRunning();
        const heartbeat = buildGenerationProgressHeartbeat({
          ...event,
          message: `00A 研究价值重试：${event.message || ""}`,
        }, startedAt);
        lastHeartbeatJson = JSON.stringify(heartbeat);
        updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
      },
    });
    cumulativeUsage = accumulateTokenUsage(cumulativeUsage, retryResult.usage);
    data = retryResult.data;
    result = retryResult;
    normalizeStage05Projection(
      data,
      judgmentJson,
      run.question,
      listSources(runId),
    );
    if (!data.delivery_archetype) data.delivery_archetype = deliveryArchetype;
    let retryReview = heuristicResearchValueReview({
      body: String(data.document_markdown || ""),
      stage01: taskContext,
      research_edge: data.research_edge,
      retry_count: 1,
    });
    retryReview.producer_model = client.model;
    // 重试后仍尝试 LLM 审查；失败则保留启发式，不得静默当过。
    try {
      const valueReviewClient = createResearchModelClient("reviewer", "stage_05");
      const llmRetry = await valueReviewClient.generateStructured(
        "research_value_review",
        researchValueReviewSchema,
        researchValueReviewPrompt(),
        JSON.stringify({
          question: run.question,
          stage01_normalized_question: taskContext?.normalized_question || null,
          document_markdown: String(data.document_markdown || "").slice(0, 24_000),
          research_edge: data.research_edge || [],
        }, null, 2),
        { maxToolRounds: 2 },
      );
      cumulativeUsage = accumulateTokenUsage(cumulativeUsage, llmRetry.usage);
      retryReview = mergeResearchValueReviews(retryReview, {
        status: llmRetry.data.status,
        checks: llmRetry.data.checks,
        retry_count: 1,
        total_score: llmRetry.data.checks.reduce((sum, item) => sum + item.score, 0),
        pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
        reviewed_at: new Date().toISOString(),
        mode: "llm",
        reviewer_model: valueReviewClient.model,
        producer_model: client.model,
      });
      retryReview.retry_count = 1;
      retryReview.mode = "combined";
    } catch {
      // keep heuristic
    }
    review = retryReview;
  }
  
  attachResearchValueReview(data, review);
  ensureStage05DocumentFields(data, {
    question: run.question,
    taskId: run.id,
    stage04: judgmentJson,
  });
  
  // A6: 表达审计 - 用 report_claims + 04 claims 投影，验证 EX→C 映射、等级一致性、审计腔禁令
  const auditInputs = toExpressionAuditInputs(data, judgmentJson);
  const expressionAudit = auditStage05Expressions(
    auditInputs.expressions,
    auditInputs.claims,
    auditInputs.judgments,
  );
  // expression_audit 仅运行时旁路；写入前会 strip，正式产物保留 expression_audit_yaml
  (data as any)._expression_audit_runtime = expressionAudit;
  
  // 审计腔清洗：05 正文移除 YAML/审计专用术语
  if (data.document_markdown) {
    data.document_markdown = sanitizeAuditVoice(String(data.document_markdown));
  }
  
  Object.assign(data, stripLegacyWriteFields(data));
  schemas.stage_05.parse(data);

  return { data, result, cumulativeUsage, lastHeartbeatJson };
}
