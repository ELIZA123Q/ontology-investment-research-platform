"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { researchJobIssueMessage } from "@/app/lib/ui-labels";
import { researchStage } from "@/app/lib/research-journey";

export function StageApprovalButton({
  runId,
  artifactId,
  stage,
  status,
  canApprove = true,
  blockingHint,
}: {
  runId: string;
  artifactId?: string;
  stage: number;
  status?: string;
  canApprove?: boolean;
  blockingHint?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const journey = researchStage(stage);

  if (!artifactId || status !== "needs_review" || !journey) return null;

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/artifacts/${artifactId}/approve`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "当前阶段暂时不能确认");
      router.push(`/runs/${runId}`);
      router.refresh();
    } catch (caught) {
      setError(researchJobIssueMessage(caught instanceof Error ? caught.message : caught));
    } finally {
      setBusy(false);
    }
  }

  return <div className="stage-approval-inline">
    <button className="button" type="button" disabled={busy || !canApprove} onClick={approve}>
      {busy ? "正在确认…" : `确认${journey.navLabel}并继续`}
    </button>
    {!canApprove && blockingHint ? <small>{blockingHint}</small> : null}
    {error ? <small className="run-primary-action-error">{error}</small> : null}
  </div>;
}
