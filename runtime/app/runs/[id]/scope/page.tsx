import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { latestArtifactPayload } from "@/adapters/db_read_models";
import { parseJson } from "@/engine/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { buildScopeResearcherView } from "@/app/lib/researcher-stage-output";
import { journeyEditHref } from "@/app/lib/research-journey";

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

  return <>
    <StageSceneChrome
      runId={id}
      stage={1}
      status={artifact.status}
      outputCount={view.outputCount}
      subtitle={run.question}
      actions={
        <>
          <StageApprovalButton runId={id} artifactId={artifact.id} stage={1} status={artifact.status} />
          <StageStatusBadge status={artifact.status} />
          <Link className="button-secondary" href={journeyEditHref(id, 1)}>修改范围</Link>
        </>
      }
    />

    {view.outputCount ? (
      <section className="structure-review-summary" aria-label="研究范围与前提">
        <article className="structure-review-card">
          <span>规范化研究问题</span>
          <strong>{section("question")?.body}</strong>
          <p>{view.summary}</p>
        </article>

        <article className="structure-review-card">
          <span>核心判断</span>
          {section("object")?.body ? <strong>{section("object")?.body}</strong> : null}
          {section("action")?.body ? <p>{section("action")?.body}</p> : null}
        </article>

        <article className="structure-review-card">
          <span>时间口径</span>
          {section("time")?.items?.length ? (
            <dl>
              {section("time")!.items!.map((item) => {
                const [label, ...rest] = item.split("：");
                return (
                  <div key={item}>
                    <dt>{label}</dt>
                    <dd>{rest.join("：")}</dd>
                  </div>
                );
              })}
            </dl>
          ) : <p className="muted">尚未登记</p>}
        </article>

        <article className="structure-review-card">
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
          {section("delivery")?.body ? <p><strong>交付落点</strong><br />{section("delivery")?.body}</p> : null}
        </article>

        <article className="structure-review-card">
          <span>前提三分法</span>
          <div className="premise-grid">
            {(["known", "assumptions", "hypotheses"] as const).map((key) => (
              <div key={key}>
                <strong>{section(key)?.label}</strong>
                <span className="muted"> {section(key)?.body}</span>
                {section(key)?.items?.length
                  ? <ul>{section(key)!.items!.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                  : <p className="muted">尚未登记</p>}
              </div>
            ))}
          </div>
        </article>
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
