import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { latestArtifactPayload } from "@/adapters/db_read_models";
import { parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) return "未设定";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export default async function ScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();

  const artifact = latestArtifactPayload(id, "stage_01", ["approved", "needs_review"]);
  const data: any = parseJson(artifact?.json_content || "{}", {});

  const coreObject = String(data.core_object || "").trim();
  const judgmentAction = String(data.judgment_action || "").trim();
  const timeScope = data.time_scope || {};
  const asOf = String(timeScope.as_of || "").trim();
  const lookback = String(timeScope.lookback || "").trim();
  const forward = String(timeScope.forward || "").trim();

  const knownFacts = Array.isArray(data.known_facts) ? data.known_facts : [];
  const userAssumptions = Array.isArray(data.user_assumptions) ? data.user_assumptions : [];
  const hypothesesToVerify = Array.isArray(data.hypotheses_to_verify) ? data.hypotheses_to_verify : [];

  const hasAnyContent = Boolean(coreObject || judgmentAction || asOf || knownFacts.length || userAssumptions.length || hypothesesToVerify.length);

  return <>
    <div className="pagehead scene-head">
      <div>
        <div className="eyebrow">研究范围</div>
        <h1>{run.question}</h1>
        <p className="muted">确认问题定义、时间边界与前提假设后，进入结构阶段。</p>
      </div>
      <div className="actions">
        <span className={`badge ${artifact?.status === "approved" ? "" : "warn"}`}>
          {artifact?.status === "approved" ? "已确认" : artifact?.status === "needs_review" ? "待确认" : artifact?.status || "尚未开始"}
        </span>
        <Link className="button-secondary" href={`/runs/${id}/stages/1`}>
          {artifact ? "编辑范围" : "生成研究范围"}
        </Link>
      </div>
    </div>

    {hasAnyContent ? (
      <section className="structure-review-summary" aria-label="研究范围与前提">
        {(coreObject || judgmentAction) ? (
          <article className="structure-review-card">
            <span>核心判断</span>
            {coreObject ? <strong>{coreObject}</strong> : null}
            {judgmentAction ? <p>{judgmentAction}</p> : null}
          </article>
        ) : null}

        {(asOf || lookback || forward) ? (
          <article className="structure-review-card">
            <span>时间范围</span>
            {asOf ? (
              <dl>
                <div><dt>截止时点</dt><dd>{formatDate(asOf)}</dd></div>
              </dl>
            ) : null}
            {lookback ? (
              <dl>
                <div><dt>回顾期</dt><dd>{lookback}</dd></div>
              </dl>
            ) : null}
            {forward ? (
              <dl>
                <div><dt>展望期</dt><dd>{forward}</dd></div>
              </dl>
            ) : null}
          </article>
        ) : null}

        <article className="structure-review-card">
          <span>前提三分法</span>
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            <div>
              <strong>已知事实</strong>
              <strong style={{ marginLeft: 8, color: "var(--muted)", fontWeight: 400 }}>{knownFacts.length} 项</strong>
              {knownFacts.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {knownFacts.slice(0, 5).map((fact: any, i: number) => (
                    <li key={i} style={{ marginBottom: 4 }}>{String(fact.statement || fact)}</li>
                  ))}
                  {knownFacts.length > 5 ? <li className="muted">另有 {knownFacts.length - 5} 项</li> : null}
                </ul>
              ) : <p className="muted">尚未登记</p>}
            </div>
            <div>
              <strong>用户假设</strong>
              <strong style={{ marginLeft: 8, color: "var(--muted)", fontWeight: 400 }}>{userAssumptions.length} 项</strong>
              {userAssumptions.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {userAssumptions.slice(0, 5).map((assumption: any, i: number) => (
                    <li key={i} style={{ marginBottom: 4 }}>{String(assumption.statement || assumption)}</li>
                  ))}
                  {userAssumptions.length > 5 ? <li className="muted">另有 {userAssumptions.length - 5} 项</li> : null}
                </ul>
              ) : <p className="muted">尚未登记</p>}
            </div>
            <div>
              <strong>待验证假设</strong>
              <strong style={{ marginLeft: 8, color: "var(--muted)", fontWeight: 400 }}>{hypothesesToVerify.length} 项</strong>
              {hypothesesToVerify.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {hypothesesToVerify.slice(0, 5).map((hypothesis: any, i: number) => (
                    <li key={i} style={{ marginBottom: 4 }}>{String(hypothesis.statement || hypothesis)}</li>
                  ))}
                  {hypothesesToVerify.length > 5 ? <li className="muted">另有 {hypothesesToVerify.length - 5} 项</li> : null}
                </ul>
              ) : <p className="muted">尚未登记</p>}
            </div>
          </div>
        </article>
      </section>
    ) : (
      <div className="card empty-state">
        <h2>尚未生成研究范围</h2>
        <p className="muted">点击右上角按钮进入范围编辑器，完成问题定义与边界设定后再回到此处审阅确认。</p>
        <Link className="button" href={`/runs/${id}/stages/1`}>生成研究范围 →</Link>
      </div>
    )}
  </>;
}
