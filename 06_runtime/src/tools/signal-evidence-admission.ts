import type { ResearchSignalCandidate } from "@/src/contracts";
import { SIGNAL_EVIDENCE_ADMISSION_RULES } from "@/src/tools/generated/signal-evidence-admission-rules";

export interface SignalCaptureRequest {
  status: "capture_required";
  signalId: string;
  taskId: string;
  source: {
    uri: string;
    title: string;
    publisherId: string;
    publishedAt: string;
    sourceType: ResearchSignalCandidate["sourceType"];
  };
  requiredFields: readonly string[];
  allowedNextActions: readonly string[];
  note: string;
}

/**
 * A signal is intentionally converted into a capture request rather than a
 * UnifiedSourceToolResult. This prevents a connector's title/excerpt from
 * crossing the SourceSnapshot and EvidenceFact boundaries by accident.
 */
export function createSignalCaptureRequest(candidate: ResearchSignalCandidate, taskId: string): SignalCaptureRequest {
  const workflow = SIGNAL_EVIDENCE_ADMISSION_RULES.research_workflow;
  const capture = SIGNAL_EVIDENCE_ADMISSION_RULES.capture_requirement;
  if (SIGNAL_EVIDENCE_ADMISSION_RULES.signal_payload.usable_as_evidence) throw new Error("Governed signal policy may not admit signal payload as evidence");
  if (!taskId.trim()) throw new Error("Signal capture request requires a task");
  return {
    status: workflow.required_task_state,
    signalId: candidate.id,
    taskId,
    source: {
      uri: candidate.sourceUri,
      title: candidate.title,
      publisherId: candidate.publisher,
      publishedAt: candidate.publishedAt,
      sourceType: candidate.sourceType,
    },
    requiredFields: capture.required_fields,
    allowedNextActions: workflow.allowed_next_actions,
    note: "该信号只是候选线索，尚未进入证据链。请重新取得原文并提交可定位摘录，或记录访问缺口。",
  };
}
