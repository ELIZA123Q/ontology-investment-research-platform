"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { researchJobIssueMessage } from "@/app/lib/ui-labels";

type PrimaryAction = { eyebrow: string; title: string; description: string; href: string; cta?: string };

export function RunPrimaryAction({ runId, action, autoContinue }: {
  runId: string;
  action: PrimaryAction;
  autoContinue: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!autoContinue) {
    return <Link className="run-primary-action" href={action.href}><ActionCopy action={action} /></Link>;
  }

  async function continueResearch() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/continue`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error || "无法继续研究"), { nextHref: body.next_href });
      router.push(body.next_href || action.href);
      router.refresh();
    } catch (caught) {
      const nextHref = caught && typeof caught === "object" && "nextHref" in caught ? String((caught as any).nextHref || "") : "";
      if (nextHref) router.push(nextHref);
      setError(researchJobIssueMessage(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setBusy(false);
    }
  }

  return <div className="run-primary-action-wrap"><button className="run-primary-action" disabled={busy} onClick={continueResearch} type="button"><ActionCopy action={{ ...action, eyebrow: busy ? "正在提交后台任务" : action.eyebrow }} /></button>{error ? <small className="run-primary-action-error">{error}</small> : null}</div>;
}

function ActionCopy({ action }: { action: PrimaryAction }) {
  return <><span>{action.eyebrow}</span><strong>{action.title}</strong><small>{action.description}</small><b>{action.cta || "继续 →"}</b></>;
}
