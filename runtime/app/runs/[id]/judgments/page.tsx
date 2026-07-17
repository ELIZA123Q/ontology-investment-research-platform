import Link from "next/link";
import { latestArtifact } from "@/adapters/db";
import { IndependentReviewButton } from "@/app/components/independent-review-button";
import { parseJson } from "@/engine/types";

export default async function Judgments({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifact(id, "stage_04", ["approved", "needs_review"]);
  if (!artifact) {
    return <div className="card"><h1>判断尚未形成</h1><p>完成并确认 03 后，运行 04 判断裁决。</p><Link href={`/runs/${id}/stages/4`}>进入阶段 04</Link></div>;
  }
  const data: any = parseJson(artifact.json_content, {});
  const reviewArtifact = latestArtifact(id, "independent_review", ["needs_review", "approved"]);
  const review: any = parseJson(reviewArtifact?.json_content || "{}", {});
  const applications = new Map((data.method_applications || []).map((item: any) => [item.application_id, item]));
  return <>
    <div className="pagehead">
      <div><div className="eyebrow">Judgment decisions</div><h1>判断卡片</h1><Link href={`/runs/${id}`}>← 返回运行总览</Link></div>
      <div className="actions">
        {artifact.status === "approved" ? <IndependentReviewButton runId={id} /> : null}
        <span className="badge">{artifact.status}</span>
      </div>
    </div>
    <div className="judgment-grid">{(data.judgments || []).map((judgment: any) => {
      const bound = (judgment.method_application_ids || []).map((ref: string) => applications.get(ref)).filter(Boolean) as any[];
      return <article className="card judgment-card" key={judgment.id}>
        <span className="eyebrow">{judgment.id} · {judgment.strength}</span>
        <h2>{judgment.title}</h2>
        <p>{judgment.conclusion}</p>
        <dl>
          <dt>为什么</dt><dd>{judgment.rationale}</dd>
          <dt>实际方法</dt><dd>{bound.length ? bound.map((item) => `${item.application_id} · ${item.method_id}@${item.method_version} · ${item.status}`).join("；") : "缺少方法应用绑定"}</dd>
          <dt>方法边界</dt><dd>{bound.map((item) => item.applicability_boundary).filter(Boolean).join("；") || "无"}</dd>
          <dt>支持草稿</dt><dd>{(judgment.supporting_evidence_draft_ids || []).join("、") || "无"}</dd>
          <dt>反证</dt><dd>{(judgment.counter_evidence_draft_ids || []).join("、") || "无"}</dd>
          <dt>不确定</dt><dd>{(judgment.uncertainties || []).join("；") || "无"}</dd>
          <dt>失效条件</dt><dd>{(judgment.invalidation_conditions || []).join("；") || "无"}</dd>
          <dt>跟踪信号</dt><dd>{(judgment.tracking_signals || []).join("；") || "无"}</dd>
        </dl>
      </article>;
    })}</div>
    {reviewArtifact ? (
      <section className="card" style={{ marginTop: 20 }}>
        <span className="eyebrow">Independent review · {review.verdict || reviewArtifact.status}</span>
        <h2>独立审阅</h2>
        <p>{review.overall_assessment}</p>
        {(review.issues || []).length ? (
          <ul>{review.issues.map((issue: any, index: number) => (
            <li key={`${issue.issue_type}-${index}`}>
              <strong>{issue.issue_type}</strong> · {issue.judgment_id || "全局"}：{issue.description}；退回 {issue.return_stage}
            </li>
          ))}</ul>
        ) : <p className="muted">未发现需要返工的实质问题。</p>}
      </section>
    ) : null}
  </>;
}
