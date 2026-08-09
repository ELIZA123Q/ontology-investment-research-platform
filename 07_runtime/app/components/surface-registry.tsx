"use client";

import { useEffect, useState } from "react";
import type { Artifact, RunEvent, TaskNode, UiSurface } from "@/src/contracts";
import { CheckIcon } from "@/app/components/icons";

export const surfaceLabels: Record<UiSurface["component"], string> = {
  clarification_form: "澄清",
  research_plan: "计划",
  evidence_matrix: "证据",
  hypothesis_map: "假设",
  judgment_card: "判断",
  comparison_table: "比较",
  chart: "图表",
  report_editor: "报告",
  approval_card: "确认",
  branch_card: "分支",
  execution_timeline: "审计",
};

const trustedComponents = new Set(Object.keys(surfaceLabels));

export function isUiSurface(value: unknown): value is UiSurface {
  if (!value || typeof value !== "object") return false;
  const item = value as { id?: unknown; title?: unknown; component?: unknown; data?: unknown; editableFields?: unknown };
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.component === "string" && trustedComponents.has(item.component) && Boolean(item.data) && typeof item.data === "object" && Array.isArray(item.editableFields);
}

const nodeStatusLabel: Record<TaskNode["status"], string> = { pending: "等待", ready: "就绪", running: "进行中", blocked: "受阻", completed: "完成", failed: "失败", cancelled: "取消" };

type ArtifactEditHandler = (artifactId: string, expectedVersion: number, changes: Record<string, unknown>) => Promise<void>;

export function SurfaceRenderer({ surface, nodes, artifacts, events, onArtifactEdit }: { surface: UiSurface; nodes: TaskNode[]; artifacts: Artifact[]; events: RunEvent[]; onArtifactEdit?: ArtifactEditHandler }) {
  switch (surface.component) {
    case "research_plan": {
      const statusById = new Map(nodes.map((node) => [node.id, node.status]));
      return <article className="artifact-content plan-artifact">
        <header><span>受约束动态计划</span><h2>{surface.title}</h2><p>{surface.data.rationale}</p></header>
        <div className="plan-graph">{surface.data.nodes.map((node, index) => {
          const status = statusById.get(node.id) || "pending";
          return <div className={`plan-step ${status}`} key={node.id}>
            <span className="step-index">{status === "completed" ? <CheckIcon /> : index + 1}</span>
            <div><strong>{node.title}</strong><small>{nodeStatusLabel[status]}{node.dependsOn.length ? ` · 依赖 ${node.dependsOn.length} 项` : " · 可立即开始"}</small></div>
          </div>;
        })}</div>
        {!!surface.data.parallelGroups.length && <div className="artifact-note"><strong>可并行处理</strong><p>{surface.data.parallelGroups.map((group) => group.length + " 个节点").join("、")}</p></div>}
        <div className="artifact-note"><strong>停止条件</strong><ul>{surface.data.stopConditions.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <blockquote>{surface.data.principle}</blockquote>
      </article>;
    }
    case "evidence_matrix": {
      const linked = surface.artifactId ? artifacts.find((artifact) => artifact.id === surface.artifactId) : undefined;
      return <article className="artifact-content evidence-artifact">
        <header><span>证据边界</span><h2>{surface.title}</h2><p>{surface.data.sufficient ? "证据达到当前最低门槛，仍需结合范围与竞争解释复核。" : "证据尚未达到形成方向判断的最低门槛。"}</p></header>
        <div className="evidence-score"><strong>{surface.data.rows.length}</strong><span>条经核验事实</span><i className={surface.data.sufficient ? "sufficient" : "insufficient"}>{surface.data.sufficient ? "门槛满足" : "仍有缺口"}</i></div>
        {surface.data.gap && <div className="gap-callout"><strong>下一项关键缺口</strong><p>{surface.data.gap}</p></div>}
        <div className="evidence-list">{surface.data.rows.length ? surface.data.rows.map((row) => <section key={row.id}><div><span>{row.factType === "forecast" ? "预测" : "事实"}</span><i>{row.confidence === "high" ? "高" : row.confidence === "medium" ? "中" : "低"}可信</i></div><p>{row.statement}</p></section>) : <div className="artifact-empty">没有可晋级的 EvidenceFact。</div>}</div>
        {!!linked?.sourceRefs.length && <section className="source-list"><h3>可核验来源</h3>{linked.sourceRefs.map((source) => <a key={source.sourceId} href={source.uri} target="_blank" rel="noreferrer"><div><strong>{source.title}</strong><small>{source.publisherId || "发布主体待识别"} · {source.sourceType === "primary" ? "一手来源" : "二手来源"}</small></div><span>{source.verification === "verified" ? "已核验 ↗" : "待核验 ↗"}</span></a>)}</section>}
      </article>;
    }
    case "hypothesis_map":
      return <article className="artifact-content"><header><span>竞争解释</span><h2>{surface.title}</h2><p>这些是假设候选，不是已经成立的判断。</p></header><div className="hypothesis-list">{surface.data.hypotheses.map((item, index) => <section key={`${item.statement}-${index}`}><span>H{index + 1}</span><div><strong>{item.statement}</strong><p>{item.falsificationConditions.length ? item.falsificationConditions.join("；") : "等待补充可证伪条件"}</p></div></section>)}</div></article>;
    case "judgment_card": {
      const artifact = surface.artifactId ? artifacts.find((item) => item.id === surface.artifactId) : undefined;
      return <JudgmentEditor surface={surface} artifact={artifact} onSave={onArtifactEdit} />;
    }
    case "report_editor": {
      const artifact = surface.artifactId ? artifacts.find((item) => item.id === surface.artifactId) : undefined;
      return <ReportEditor surface={surface} artifact={artifact} onSave={onArtifactEdit} />;
    }
    case "clarification_form":
      return <article className="artifact-content"><header><span>开始前确认</span><h2>{surface.title}</h2></header><ol className="question-list">{surface.data.questions.map((question) => <li key={question}>{question}</li>)}</ol></article>;
    case "comparison_table":
      return <article className="artifact-content"><header><span>结构化比较</span><h2>{surface.title}</h2></header><div className="table-scroll"><table><thead><tr>{surface.data.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{surface.data.rows.map((row, index) => <tr key={index}>{surface.data.columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div></article>;
    case "chart":
      return <article className="artifact-content"><header><span>数据图表</span><h2>{surface.title}</h2></header><div className="artifact-empty">图表数据已通过可信结构校验；当前版本暂以数据表呈现。</div><div className="table-scroll"><table><thead><tr><th>{surface.data.xKey}</th>{surface.data.series.map((item) => <th key={item.key}>{item.label}</th>)}</tr></thead><tbody>{surface.data.rows.map((row, index) => <tr key={index}><td>{String(row[surface.data.xKey] ?? "—")}</td>{surface.data.series.map((item) => <td key={item.key}>{String(row[item.key] ?? "—")}</td>)}</tr>)}</tbody></table></div></article>;
    case "execution_timeline":
      return <AuditTimeline events={events.filter((event) => surface.data.eventIds.includes(event.id))} />;
    case "approval_card":
      return <article className="artifact-content"><header><span>需要确认</span><h2>{surface.title}</h2><p>{surface.data.prompt}</p></header></article>;
    case "branch_card":
      return <article className="artifact-content"><header><span>研究分支</span><h2>{surface.title}</h2><p>{surface.data.revisedGoal}</p></header></article>;
    default:
      return <div className="artifact-empty">此可信制品暂未启用展示。</div>;
  }
}

function JudgmentEditor({ surface, artifact, onSave }: { surface: Extract<UiSurface, { component: "judgment_card" }>; artifact?: Artifact; onSave?: ArtifactEditHandler }) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(surface.data.statement);
  const [confidence, setConfidence] = useState(surface.data.confidence || "insufficient");
  const [conditions, setConditions] = useState(surface.data.changeConditions.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setStatement(surface.data.statement); setConfidence(surface.data.confidence || "insufficient");
    setConditions(surface.data.changeConditions.join("\n")); setEditing(false); setError("");
  }, [surface.id, surface.data.statement, surface.data.confidence, surface.data.changeConditions]);
  const canEdit = Boolean(artifact && onSave && surface.editableFields.length);
  async function save() {
    if (!artifact || !onSave) return;
    const changes: Record<string, unknown> = {};
    if (surface.editableFields.includes("statement")) changes.statement = statement.trim();
    if (surface.editableFields.includes("confidence")) changes.confidence = confidence;
    if (surface.editableFields.includes("changeConditions")) changes.changeConditions = conditions.split("\n").map((item) => item.trim()).filter(Boolean);
    setSaving(true); setError("");
    try { await onSave(artifact.id, artifact.version, changes); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }
  return <article className="artifact-content judgment-artifact">
    <header><span>当前判断 · v{artifact?.version || 1}</span><h2>{surface.data.statement}</h2></header>
    <div className="judgment-state"><strong>{surface.data.disposition === "abstain" || surface.data.epistemicStatus === "indeterminate" ? "暂不可判断" : "需要研究员复核"}</strong><span>置信边界：{surface.data.confidence || "未评估"}</span></div>
    {editing ? <div className="artifact-editor">
      {surface.editableFields.includes("statement") && <label>判断表述<textarea value={statement} onChange={(event) => setStatement(event.target.value)} /></label>}
      {surface.editableFields.includes("confidence") && <label>置信边界<select value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="insufficient">证据不足</option></select></label>}
      {surface.editableFields.includes("changeConditions") && <label>改判条件（每行一项）<textarea value={conditions} onChange={(event) => setConditions(event.target.value)} /></label>}
      {error && <p className="inline-error">{error}</p>}<div><button onClick={() => setEditing(false)} disabled={saving}>取消</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中" : "保存新版本"}</button></div>
    </div> : <><section><h3>改判条件</h3><ul>{surface.data.changeConditions.map((item) => <li key={item}>{item}</li>)}</ul></section>{canEdit && <div className="artifact-edit-bar"><span>修改后将生成新版本，并重新确认后续报告。</span><button onClick={() => setEditing(true)}>编辑判断</button></div>}</>}
    <p className="judgment-boundary">判断不会因为流程完成而自动变成高置信结论。</p>
  </article>;
}

function ReportEditor({ surface, artifact, onSave }: { surface: Extract<UiSurface, { component: "report_editor" }>; artifact?: Artifact; onSave?: ArtifactEditHandler }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(surface.data.summary);
  const [boundary, setBoundary] = useState(surface.data.boundary || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSummary(surface.data.summary); setBoundary(surface.data.boundary || ""); setEditing(false); setError(""); }, [surface.id, surface.data.summary, surface.data.boundary]);
  const canEdit = Boolean(artifact && onSave && surface.editableFields.length);
  async function save() {
    if (!artifact || !onSave) return;
    const changes: Record<string, unknown> = {};
    if (surface.editableFields.includes("summary")) changes.summary = summary.trim();
    if (surface.editableFields.includes("boundary")) changes.boundary = boundary.trim();
    setSaving(true); setError("");
    try { await onSave(artifact.id, artifact.version, changes); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }
  return <article className="artifact-content report-artifact">
    <header><span>研究备忘录 · v{artifact?.version || 1}</span><h2>{surface.title}</h2></header>
    {editing ? <div className="artifact-editor"><label>摘要<textarea className="report-textarea" value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label>表达边界<textarea value={boundary} onChange={(event) => setBoundary(event.target.value)} /></label>{error && <p className="inline-error">{error}</p>}<div><button onClick={() => setEditing(false)} disabled={saving}>取消</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中" : "保存并重新审计"}</button></div></div> : <><div className="report-body"><p>{surface.data.summary}</p></div>{surface.data.boundary && <aside><strong>表达边界</strong><p>{surface.data.boundary}</p></aside>}{canEdit && <div className="artifact-edit-bar"><span>正文修订保留版本记录，并重新运行确定性审计。</span><button onClick={() => setEditing(true)}>编辑报告</button></div>}</>}
  </article>;
}

const eventLabels: Record<string, string> = {
  "plan.proposed": "Research Lead 提出了研究计划",
  "planner.compiled": "计划已通过确定性编译",
  "approval.requested": "正在等待你的确认",
  "approval.decided": "你已处理确认请求",
  "task.started": "本轮研究开始执行",
  "task.settled": "本轮研究已结束",
  "source.discovered": "发现了候选来源",
  "source.captured": "来源快照已保存",
  "evidence.promoted": "合格事实已进入证据包",
  "artifact.edited": "研究员修订了结构化制品",
  "artifact.recompute_queued": "受影响的下游节点已进入重算队列",
  "context.assembled": "研究上下文已装配",
  "context.pinned": "已固定选中的发布知识",
  "task.cancelled": "你取消了本轮研究",
  "task.branched": "你创建了研究分支",
  "task.resume_queued": "恢复请求已进入队列",
};

export function AuditTimeline({ events }: { events: RunEvent[] }) {
  const visible = events.filter((event) => event.type !== "message.created").slice(-30).reverse();
  return <article className="artifact-content audit-artifact"><header><span>运行审计</span><h2>发生了什么</h2><p>默认只显示对研究路径有意义的事件，内部参数保持折叠。</p></header><div className="audit-list">{visible.map((event) => <div key={event.id}><i/><div><strong>{eventLabels[event.type] || event.type.replaceAll(".", " ")}</strong><time>{new Date(event.createdAt).toLocaleString("zh-CN")}</time></div></div>)}</div></article>;
}
