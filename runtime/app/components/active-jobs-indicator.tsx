"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { latestJobPerRun, researchJobStatusLabel, stageLabel } from "@/app/lib/ui-labels";
import { journeyJobHref } from "@/app/lib/research-journey";

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

export function ActiveJobsIndicator() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [open, setOpen] = useState(false);
  const menuId = useId();

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
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span className="busy-dot" aria-hidden="true" />
        <span className="system-state-label">{label}</span>
      </button>
      {open ? (
        <div id={menuId} className="system-state-dropdown" role="menu">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={journeyJobHref(job.run_id, job.stage, job.status)}
              className="system-state-item"
              role="menuitem"
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
