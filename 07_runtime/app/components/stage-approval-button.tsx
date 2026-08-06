"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { researchJobIssueMessage } from "@/app/lib/ui-labels";
import { journeyApproveLabel, journeyNextHref, researchStage } from "@/app/lib/research-journey";
import { InlineFeedback } from "@/app/components/inline-feedback";

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
      if (stage === 2) {
        const preflight = await fetch(`/api/runs/${runId}/artifacts/${artifactId}/validate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "preflight" }),
        });
        const validationBody = await preflight.json();
        if (!preflight.ok) throw new Error(validationBody.error || "确认前校验失败");
        if (!validationBody.ok) {
          throw new Error(validationBody.summary || "结构校验未通过，请回到编辑页修改后再确认");
        }
      }
      const response = await fetch(`/api/runs/${runId}/artifacts/${artifactId}/approve`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "当前阶段暂时不能确认");
      router.push(journeyNextHref(runId, stage));
      router.refresh();
    } catch (caught) {
      setError(researchJobIssueMessage(caught instanceof Error ? caught.message : caught));
    } finally {
      setBusy(false);
    }
  }

  return <div className="stage-approval-inline">
    <button className="button" type="button" disabled={busy || !canApprove} onClick={approve} aria-busy={busy}>
      {busy ? "正在确认…" : journeyApproveLabel(stage)}
    </button>
    {!canApprove && blockingHint ? <small>{blockingHint}</small> : null}
    <InlineFeedback message={error} tone="error" />
  </div>;
}
