import { artifactStatusLabel } from "@/app/lib/ui-labels";

type StageStatusBadgeProps = {
  status?: string | null;
  pendingCount?: number;
  label?: string;
  className?: string;
};

/** 五阶段共用状态徽章：已确认 / 待确认 / 生成中 / 受阻。 */
export function StageStatusBadge({
  status,
  pendingCount = 0,
  label,
  className = "",
}: StageStatusBadgeProps) {
  const resolved = label || (
    status === "needs_review" && pendingCount > 0
      ? `待处理 ${pendingCount}`
      : artifactStatusLabel(String(status || "draft"))
  );
  const tone = status === "approved"
    ? ""
    : status === "failed" || pendingCount > 0
      ? "warn"
      : status === "running"
        ? "info"
        : "warn";
  return (
    <span className={`badge stage-status-badge ${tone} ${className}`.trim()}>
      {resolved}
    </span>
  );
}
