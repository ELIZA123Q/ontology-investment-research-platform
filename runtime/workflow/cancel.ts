import "server-only";
import {
getArtifact,
updateArtifactIfStatus
} from "../storage/db";

export function cancelGeneration(artifactId: string) {
  const artifact = getArtifact(artifactId);
  if (!artifact) throw new Error("产物不存在");
  if (artifact.status !== "running") throw new Error("只有运行中的生成可以取消");
  const cancelled = updateArtifactIfStatus(artifactId, "running", {
    status: "failed",
    error_message: "[model_output_error] GENERATION_CANCELLED: 用户取消了本次生成，旧请求不得写回",
    tool_usage: JSON.stringify({ failure_category: "model_output_error", cancelled_by_user: true }),
  });
  if (!cancelled) throw new Error("生成状态已变化，请刷新后重试");
  return cancelled;
}

