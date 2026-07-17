import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunBundle, latestArtifact, listSources, previousComparableRun } from "@/adapters/db";
import { BaselineButton } from "@/app/components/baseline-button";
import { PublishButton } from "@/app/components/publish-button";
import { runDifferenceAttribution } from "@/engine/metrics";
import { STAGES } from "@/engine/types";

export const dynamic = "force-dynamic";
const names = ["问题定义", "判断结构", "来源与证据草稿", "判断裁决", "研究表达"];

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = getRunBundle(id);
  if (!b) notFound();
  const baseline = latestArtifact(id, "baseline");
  const previousRun = previousComparableRun(id);
  const attribution = previousRun
    ? runDifferenceAttribution(
      {
        stage03: latestArtifact(previousRun.id, "stage_03", ["approved"]),
        stage04: latestArtifact(previousRun.id, "stage_04", ["approved"]),
        sources: listSources(previousRun.id),
      },
      {
        stage03: latestArtifact(id, "stage_03", ["approved"]),
        stage04: latestArtifact(id, "stage_04", ["approved"]),
        sources: b.sources,
      },
    )
    : null;
  const completedStages = Object.values(b.manifest.stages).filter((s) => s.stage_status === "complete").length;

  return (
    <>
      <section className="run-summary">
        <div>
          <div className="eyebrow">Research run · {b.run.domain === "semiconductor" ? "Semiconductor" : "General"}</div>
          <h1>{b.run.question}</h1>
          <div className="run-meta">
            <span>阶段 {b.run.current_stage}/5</span>
            <span>状态 {b.run.status}</span>
            <span>Manifest {completedStages}/5</span>
            {b.manifest.validation_summary?.publish_status ? <span>{b.manifest.validation_summary.publish_status}</span> : null}
            {b.run.package_path ? <span>已绑定样例包</span> : null}
          </div>
        </div>
        <div className="actions run-actions">
          <PublishButton runId={id} />
          <BaselineButton runId={id} />
        </div>
      </section>
      <div className="timeline">
        {STAGES.map((s, i) => {
          const a = latestArtifact(id, s);
          const isCurrent = b.run.current_stage === i;
          return (
            <Link
              key={s}
              href={`/runs/${id}/stages/${i + 1}`}
              className={`step ${a?.status === "approved" ? "done" : ""} ${isCurrent ? "current" : ""} ${a?.status === "failed" ? "failed" : ""}`}
            >
              <span className="step-number">0{i + 1}</span><span className="step-status-dot" />
              <strong>{names[i]}</strong>
              <span>{a?.status || "not_started"}</span>
            </Link>
          );
        })}
      </div>
      <div className="section-head"><div><div className="eyebrow">Outputs & inspection</div><h2>研究资产</h2></div><span className="section-meta">判断、实例、表达与实验</span></div>
      <div className="grid">
        <Link className="card run-card" href={`/runs/${id}/judgments`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="card-arrow">↗</span>
          <span className="eyebrow">Core output</span>
          <h3>判断卡片</h3>
          <p>集中查看判断、依据、反证、不确定性与失效条件。</p>
        </Link>
        <Link className="card run-card" href={`/runs/${id}/object-set`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="card-arrow">↗</span>
          <span className="eyebrow">Object Set</span>
          <h3>本体实例集合</h3>
          <p>按类型查询、关系展开，并对选中对象提出 Action 提案。</p>
        </Link>
        <Link className="card run-card" href={`/runs/${id}/report`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="card-arrow">↗</span>
          <span className="eyebrow">Expression</span>
          <h3>最终报告</h3>
          <p>查看并导出阶段 05 Markdown。</p>
        </Link>
        <Link className="card run-card" href={`/runs/${id}/compare`} style={{ textDecoration: "none", color: "inherit" }}>
          <span className="card-arrow">↗</span>
          <span className="eyebrow">Experiment</span>
          <h3>A/B 对照</h3>
          <p>{baseline ? "普通基线已生成，可开始盲评。" : "先生成普通 GPT 基线。"}</p>
        </Link>
      </div>
      {previousRun && attribution ? (
        <>
          <div className="section-head">
            <div><div className="eyebrow">Repeat-run attribution</div><h2>同题运行差异</h2></div>
            <Link className="backlink" href={`/runs/${previousRun.id}`}>查看上一次运行 →</Link>
          </div>
          <section className="card">
            <p>归因：{attribution.causes.join("、")}</p>
            <div className="run-meta">
              <span>新增来源 {attribution.evidence.added_sources.length}</span>
              <span>移除来源 {attribution.evidence.removed_sources.length}</span>
              <span>方法变化 {attribution.methods.changed.length}</span>
              <span>判断变化 {attribution.judgments.changed.length}</span>
              <span>模型变化 {attribution.runtime.model_changed ? "是" : "否"}</span>
              <span>上下文变化 {attribution.runtime.knowledge_changed ? "是" : "否"}</span>
            </div>
            <details>
              <summary>查看结构化归因记录</summary>
              <pre>{JSON.stringify(attribution, null, 2)}</pre>
            </details>
          </section>
        </>
      ) : null}
    </>
  );
}
