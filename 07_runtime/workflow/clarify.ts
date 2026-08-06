import "server-only";
import {
getRun,
latestArtifact
} from "../storage/db";
import { syncStage01ReadableMarkdown } from "../skills/expression_audit/readable_markdown";
import { schemas } from "../schemas/schemas";
import { applyClarificationAnswer,applyClarificationAnswers,pendingClarificationQuestion } from "../agents/01_intake/input_contract";
import { parseJson,type Artifact } from "../schemas/types";
import {
editArtifact
} from "./shared";

/** Stage01：一次提交全部澄清回答并写回产物；随后应重新生成 Stage01。 */
export function clarifyStage01(
  runId: string,
  answerOrAnswers: string | Array<{ question_id?: string; answer: string }>,
  options: { question_id?: string; regenerate?: boolean } = {},
): Artifact {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const artifact = latestArtifact(runId, "stage_01", ["needs_review"]);
  if (!artifact) throw new Error("尚无待澄清的 Stage01 草稿");
  const previous = parseJson<any>(artifact.json_content, {});
  if (String(previous.task_disposition || "") !== "needs_clarification"
    && !pendingClarificationQuestion(previous)) {
    throw new Error("当前 Stage01 不处于待澄清状态");
  }
  const next = Array.isArray(answerOrAnswers)
    ? applyClarificationAnswers(previous, answerOrAnswers)
    : applyClarificationAnswer(previous, answerOrAnswers, { question_id: options.question_id });
  syncStage01ReadableMarkdown(next, run.question);
  schemas.stage_01.parse(next);
  return editArtifact(artifact.id, JSON.stringify(next, null, 2), next.document_markdown);
}
