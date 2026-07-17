import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunBundle, latestArtifact } from "@/adapters/db";
import { BaselineButton } from "@/app/components/baseline-button";
import { PublishButton } from "@/app/components/publish-button";
import { STAGES } from "@/engine/types";

export const dynamic = "force-dynamic";
const names = ["问题定义", "判断结构", "来源与证据草稿", "判断裁决", "研究表达"];

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = getRunBundle(id);
  if (!b) notFound();
  const baseline = latestArtifact(id, "baseline");
  const completedStages = Object.values(b.manifest.stages).filter((s) => s.stage_status === "complete").length;

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Research run · {b.run.domain}</div>
          <h1>{b.run.question}</h1>
          <p className="muted">
            当前阶段 {b.run.current_stage}/5 · {b.run.status}
            {b.run.package_path ? ` · 绑定 ${b.run.package_path}` : ""}
            {` · manifest ${completedStages}/5`}
            {b.manifest.validation_summary?.publish_status
              ? ` · ${b.manifest.validation_summary.publish_status}`
              : ""}
          </p>
        </div>
        <div className="actions">
          <PublishButton runId={id} />
          <BaselineButton runId={id} />
        </div>
      </div>
      <div className="timeline">
        {STAGES.map((s, i) => {
          const a = latestArtifact(id, s);
          return (
            <Link
              key={s}
              href={`/runs/${id}/stages/${i + 1}`}
              className={`step ${a?.status === "approved" ? "done" : ""} ${b.run.current_stage === i ? "current" : ""}`}
            >
              <strong>
                0{i + 1} · {names[i]}
              </strong>
              <span>{a?.status || "not_started"}</span>
            </Link>
          );
        })}
      </div>
      <div className="grid">
        <Link className="card run-card" href={`/runs/${id}/judgments`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="eyebrow">Core output</span>
          <h3>判断卡片</h3>
          <p>集中查看判断、依据、反证、不确定性与失效条件。</p>
        </Link>
        <Link className="card run-card" href={`/runs/${id}/object-set`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="eyebrow">Object Set</span>
          <h3>本体实例集合</h3>
          <p>按类型查询、关系展开，并对选中对象提出 Action 提案。</p>
        </Link>
        <Link className="card run-card" href={`/runs/${id}/report`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="eyebrow">Expression</span>
          <h3>最终报告</h3>
          <p>查看并导出阶段 05 Markdown。</p>
        </Link>
        <Link className="card run-card" href={`/runs/${id}/compare`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="eyebrow">Experiment</span>
          <h3>A/B 对照</h3>
          <p>{baseline ? "普通基线已生成，可开始盲评。" : "先生成普通 GPT 基线。"}</p>
        </Link>
      </div>
    </>
  );
}
