import Link from "next/link";
import { judgmentStrengthLabel } from "@/app/lib/researcher-stage-output";
import { objectTypeLabel } from "@/app/lib/ui-labels";
import {
  objectDisplayLabel,
  relationRepairHref,
  type JudgmentRelationAudit,
  type RelationAuditStatus,
} from "@/engine/relation_audit";
import type { GraphObject } from "@/engine/instance_graph";

const STATUS_COPY: Record<RelationAuditStatus, { label: string; note: string }> = {
  complete: { label: "关系完整", note: "正式范围、证据和推理链均可追溯。" },
  limited: { label: "研究受限", note: "关系结构可用，但证据缺失或结论边界仍未解除。" },
  broken: { label: "关系错误", note: "存在缺少正式中介、悬空或必需绑定的问题。" },
};

function ObjectList({ values, empty }: { values: GraphObject[]; empty: string }) {
  return values.length ? <ul>{values.map((object) => <li key={object.id}><strong>{objectDisplayLabel(object)}</strong><small>{objectTypeLabel(object.type)}</small></li>)}</ul> : <p className="muted">{empty}</p>;
}

export function JudgmentRelationAuditPanel({ runId, audits, problemsOnly = false }: {
  runId: string;
  audits: JudgmentRelationAudit[];
  problemsOnly?: boolean;
}) {
  const visible = problemsOnly ? audits.filter((audit) => audit.status !== "complete") : audits;
  const counts = {
    complete: audits.filter((item) => item.status === "complete").length,
    limited: audits.filter((item) => item.status === "limited").length,
    broken: audits.filter((item) => item.status === "broken").length,
  };
  return <>
    <section className="relation-audit-summary" aria-label="关系审计摘要">
      <article><span>关系完整</span><strong>{counts.complete}</strong><small>正式链路齐全</small></article>
      <article><span>研究受限</span><strong>{counts.limited}</strong><small>结构可用但证据有限</small></article>
      <article><span>关系错误</span><strong>{counts.broken}</strong><small>需要回原阶段修复</small></article>
      <div className="relation-audit-filter">
        <Link className={!problemsOnly ? "active" : ""} href={`/runs/${runId}/object-set?view=judgments`}>全部判断</Link>
        <Link className={problemsOnly ? "active" : ""} href={`/runs/${runId}/object-set?view=judgments&filter=problems`}>仅看问题</Link>
      </div>
    </section>
    {visible.length ? <section className="judgment-relation-list" aria-label="按判断核对正式关系">
      {visible.map((audit, index) => {
        const status = STATUS_COPY[audit.status];
        return <details className={`judgment-relation-card is-${audit.status}`} key={audit.id} open={audit.status === "broken"}>
          <summary>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><small>{judgmentStrengthLabel(audit.strength)} · {audit.decisionStatus || "已登记判断"}</small><strong>{audit.label}</strong></div>
            <em>{status.label}</em>
          </summary>
          <div className="judgment-relation-body">
            <p className="relation-status-note">{status.note}</p>
            <div className="relation-chain-grid">
              <article>
                <header><span>01</span><strong>判断对象与范围</strong></header>
                <ObjectList values={[...(audit.unit ? [audit.unit] : []), ...audit.scopes, ...audit.stateVariables]} empty="尚未形成可追溯的判断对象、范围或状态变量" />
              </article>
              <article>
                <header><span>02</span><strong>必要证据</strong></header>
                {audit.requirements.length ? <ul>{audit.requirements.map((item) => <li key={item.object.id}>
                  <strong>{objectDisplayLabel(item.object)}</strong>
                  <small>{item.role === "counter" ? "反证要求" : item.role === "context" ? "背景要求" : "支持要求"} · {item.fulfillment === "met" ? "已满足" : item.fulfillment === "partial" ? "部分满足" : "尚未满足"}</small>
                </li>)}</ul> : <p className="muted">尚未登记正式证据要求</p>}
              </article>
              <article>
                <header><span>03</span><strong>事实如何进入推理</strong></header>
                <ObjectList values={[...audit.sources, ...audit.facts, ...audit.signals, ...audit.hypotheses, ...audit.competingExplanations]} empty="当前没有可展示的来源—事实—信号—假设链" />
              </article>
              <article>
                <header><span>04</span><strong>裁决与改判</strong></header>
                <ObjectList values={[...audit.rules, ...audit.methods, ...audit.traces]} empty="尚未登记规则、方法或推理留痕" />
                {audit.invalidationConditions.length ? <div className="relation-invalidation"><strong>改判条件</strong>{audit.invalidationConditions.map((item) => <small key={item}>{item}</small>)}</div> : null}
              </article>
            </div>
            {audit.issues.length ? <section className="relation-issue-list">
              <h3>需要处理的问题</h3>
              {audit.issues.map((issue, issueIndex) => <article key={`${issue.code}:${issue.targetId}:${issueIndex}`} className={`is-${issue.severity}`}>
                <div><span>{issue.severity === "error" ? "关系错误" : "研究限制"}</span><strong>{issue.title}</strong><p>{issue.impact}</p></div>
                <Link href={relationRepairHref(runId, issue)}>回到{issue.repairStage === "structure" ? "结构" : issue.repairStage === "evidence" ? "证据" : "判断"}修复 →</Link>
              </article>)}
            </section> : null}
            <details className="technical-details"><summary>技术详情</summary><p>判断编号 {audit.id}{audit.unit ? ` · 判断单元 ${audit.unit.id}` : ""}</p></details>
          </div>
        </details>;
      })}
    </section> : <section className="card empty-state"><h2>{problemsOnly ? "没有需要处理的关系问题" : "尚无可审计判断"}</h2><p className="muted">{problemsOnly ? "当前判断的正式关系均已完整登记。" : "完成判断阶段后，这里会按判断展示正式关系。"}</p></section>}
  </>;
}

