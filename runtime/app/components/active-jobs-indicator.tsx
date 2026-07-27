"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { latestJobPerRun, researchJobStatusLabel, stageLabel } from "@/app/lib/ui-labels";

type ActiveJob = {
  id: string;
  run_id: string;
  stage: string;
  status: string;
  job_type: string;
  updated_at: string;
  last_error: string | null;
  question?: string;
};

function stageHref(runId: string, stage: string) {
  if (stage === "stage_01") return `/runs/${runId}/stages/1`;
  if (stage === "stage_02") return `/runs/${runId}/structure`;
  if (stage === "stage_03") return `/runs/${runId}/evidence`;
  if (stage === "stage_04") return `/runs/${runId}/judgments`;
  if (stage === "stage_05") return `/runs/${runId}/report`;
  return `/runs/${runId}`;
}

export function ActiveJobsIndicator() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/runs", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const runMap = new Map((data.runs || []).map((run: any) => [run.id, run.question]));
        const next = (Array.isArray(data.active_jobs) ? data.active_jobs : []).map((job: ActiveJob) => ({
          ...job,
          question: String(runMap.get(job.run_id) || ""),
        }));
        setJobs(latestJobPerRun(next));
      } catch {
        // ignore polling errors
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!jobs.length) {
    return null;
  }

  const inFlightCount = jobs.filter((job) => ["queued", "running", "retrying"].includes(job.status)).length;
  const attentionCount = jobs.length - inFlightCount;
  const label = inFlightCount
    ? `AI 处理中 · ${inFlightCount}${attentionCount ? ` · 待处理 ${attentionCount}` : ""}`
    : `待处理研究 · ${attentionCount}`;

  return (
    <div className={`system-state-menu${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="system-state is-busy"
        onClick={() => setOpen((value) => !value)}
        title="查看后台研究任务"
      >
        <span className="busy-dot" aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div className="system-state-dropdown" role="menu">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={stageHref(job.run_id, job.stage)}
              className="system-state-item"
              onClick={() => setOpen(false)}
            >
              <strong>{job.question || job.run_id.slice(0, 8)}</strong>
              <small>{stageLabel(job.stage)} · {researchJobStatusLabel(job.status)}</small>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
