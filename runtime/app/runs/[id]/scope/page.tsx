import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/storage/db";
import { latestArtifactPayload } from "@/storage/db_read_models";
import { parseJson } from "@/schemas/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { buildScopeResearcherView, buildStageDecisionView } from "@/app/lib/researcher-stage-output";
import { journeyEditHref } from "@/app/lib/research-journey";
import { StageExceptionNotice } from "@/app/components/stage-exception-notice";

export const dynamic = "force-dynamic";

export default async function ScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();

  const artifact = latestArtifactPayload(id, "stage_01", ["approved", "needs_review"]);
  if (!artifact) {
    return (
      <EmptyState
        title="尚未生成研究范围"
        description="先进入范围编辑页收敛研究对象、判断动作、时间口径与边界，再回到此处审阅确认。"
        actionHref={journeyEditHref(id, 1)}
        actionLabel="生成研究范围 →"
      />
    );
  }
  const data: any = parseJson(artifact.json_content || "{}", {});
  const view = buildScopeResearcherView(data, {
    artifactStatus: artifact.status,
    fallbackQuestion: run.question,
  });
  const section = (key: string) => view.sections.find((item) => item.id === key);
  const decision = buildStageDecisionView({
    outcome: view.summary,
    blockingReasons: view.proceed.blockingReasons,
    blockingTitle: "研究范围还不能确认",
  });

  return <>
    <StageSceneChrome
      runId={id}
      stage={1}
      status={artifact.status}
      outputCount={view.outputCount}
      actions={
        <>
          {view.proceed.canProceed ? <StageApprovalButton runId={id} artifactId={artifact.id} stage={1} status={artifact.status} /> : null}
          <StageStatusBadge status={artifact.status} />
          {view.proceed.canProceed ? <Link className="button-secondary" href={journeyEditHref(id, 1)}>修改范围</Link> : null}
        </>
      }
    />

    <StageExceptionNotice exception={decision.exception ? {
      ...decision.exception,
      href: journeyEditHref(id, 1),
      actionLabel: "修正研究范围 →",
    } : null} />

    {view.outputCount ? (
      <section className="scope-decision-card" aria-label="研究范围与前提">
        <article className="scope-question-block">
          <span>规范化研究问题</span>
          <strong>{section("question")?.body}</strong>
        </article>
        <div className="scope-facts-grid">
          <article>
            <span>研究对象</span>
            <strong>{section("object")?.body || "尚未登记"}</strong>
          </article>
          <article>
            <span>要做的判断</span>
            <strong>{section("action")?.body || "尚未登记"}</strong>
          </article>
          <article>
            <span>时间口径</span>
            {section("time")?.items?.length ? <dl>
              {section("time")!.items!.map((item) => {
                const [label, ...rest] = item.split("：");
                return (
                  <div key={item}>
                    <dt>{label}</dt>
                    <dd>{rest.join("：")}</dd>
                  </div>
                );
              })}
            </dl> : <p className="muted">尚未登记</p>}
          </article>
        </div>
        <article className="scope-boundary-block">
          <span>边界与排除</span>
          <div className="premise-grid">
            <div>
              <strong>研究边界</strong>
              {section("boundaries")?.items?.length
                ? <ul>{section("boundaries")!.items!.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
                : <p className="muted">尚未登记</p>}
            </div>
            <div>
              <strong>不研究事项</strong>
              {section("exclusions")?.items?.length
                ? <ul>{section("exclusions")!.items!.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
                : <p className="muted">尚未登记</p>}
            </div>
          </div>
        </article>
        <details className="stage-inline-details" open={view.proceed.blockingReasons.length > 0}>
          <summary><strong>研究前提</strong><span>已知事实、用户假设与待验证假设</span></summary>
          <div className="premise-grid">
            {(["known", "assumptions", "hypotheses"] as const).map((key) => (
              <div key={key}>
                <strong>{section(key)?.label}</strong>
                <span className="muted"> {section(key)?.body}</span>
                {section(key)?.items?.length
                  ? <ul>{section(key)!.items!.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                  : <p className="muted">{section(key)?.emptyBody || "尚未登记"}</p>}
              </div>
            ))}
          </div>
        </details>
      </section>
    ) : (
      <EmptyState
        title="范围草稿还不完整"
        description="请回到编辑页补齐规范化问题、边界与排除项后再确认。"
        actionHref={journeyEditHref(id, 1)}
        actionLabel="继续编辑范围 →"
      />
    )}
  </>;
}
