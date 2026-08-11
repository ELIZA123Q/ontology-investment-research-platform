import type { Task, TaskStatus } from "@/src/contracts";

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || `请求失败：${response.status}`);
  return payload as T;
}

export const taskStatusLabel: Record<TaskStatus, string> = {
  planned: "计划生成中",
  queued: "等待执行",
  running: "研究进行中",
  paused: "已暂停",
  waiting_input: "等待补充",
  waiting_approval: "等待确认",
  waiting_handoff: "等待协作",
  completed: "研究完成",
  failed: "执行失败",
  cancelled: "已取消",
};

export function taskStatusText(task: Task): string {
  if (task.outcome === "completed_with_judgment") return "已形成正式判断";
  if (task.outcome === "stopped_insufficient_evidence") return "因证据不足停止";
  if (task.outcome === "cancelled") return "已取消";
  if (task.outcome === "failed") return "执行失败";
  return taskStatusLabel[task.status];
}

export function formatRelativeTime(value: string): string {
  const delta = Date.now() - Date.parse(value);
  if (!Number.isFinite(delta) || delta < 0) return new Date(value).toLocaleDateString("zh-CN");
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}
