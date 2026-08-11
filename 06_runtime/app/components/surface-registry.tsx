"use client";

import { useEffect, useState } from "react";
import type { Artifact, RunEvent, SignalRole, TaskNode, UiSurface } from "@/src/contracts";
import { CheckIcon } from "@/app/components/icons";
import { REPORT_KIND_LABELS } from "@/src/reporting/report-spec";

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
        {!!surface.data.lensSuggestions?.length && <section className="method-blueprint"><header><strong>建议研究 Lens</strong><span>{surface.data.problemGraph?.lensRefs?.join(" + ") || "待研究员确认"}</span></header><p>Lens 共享同一语义对象和证据链；确认计划后会固化到 ResearchMandate。</p><div>{surface.data.lensSuggestions.map((lens) => <article key={lens.id}><span>{lens.id}</span><div><strong>{lens.label || lens.id}</strong><small>{lens.evidenceRoles?.join(" / ") || "evidence"}</small><p>{lens.reason}</p>{!!lens.requiredOutputs?.length && <p>覆盖：{lens.requiredOutputs.join("、")}</p>}</div></article>)}</div></section>}
        {surface.data.problemGraph && <section className="method-blueprint"><header><strong>Research Problem Graph</strong><span>{surface.data.problemGraph.taskMotifRefs.join(" · ")}</span></header><p>研究以判断单元为中心；每个单元分别保留主假设、竞争解释和支持／反证／边界证据缺口。</p><div>{surface.data.problemGraph.nodes.filter((node) => node.type === "judgment_unit").map((node) => {
          const requirements = surface.data.problemGraph!.edges.filter((edge) => edge.toNodeId === node.id && edge.relation === "requires").map((edge) => surface.data.problemGraph!.nodes.find((item) => item.id === edge.fromNodeId)).filter(Boolean);
          return <article key={node.id}><span>{node.state}</span><div><strong>{node.title}</strong><small>{requirements.map((item) => String(item?.payload.evidenceRole || "evidence")).join(" / ")}</small><p>{node.state === "resolved" ? "已裁决" : node.state === "blocked" ? "专业阻断" : node.state === "indeterminate" ? "暂不可判断" : "等待研究"}</p></div></article>;
        })}</div></section>}
        <div className="plan-graph">{surface.data.nodes.map((node) => {
          const status = statusById.get(node.id) || "pending";
          return <div className={`plan-step ${status}`} key={node.id}>
            <span className="step-index">{status === "completed" ? <CheckIcon /> : "•"}</span>
            <div><strong>{node.title}</strong><small>{nodeStatusLabel[status]}{node.frontierRef?.evidenceRole ? ` · ${node.frontierRef.evidenceRole} evidence` : node.dependsOn.length ? ` · 依赖 ${node.dependsOn.length} 项` : " · 共享治理节点"}</small></div>
          </div>;
        })}</div>
        {!!surface.data.parallelGroups.length && <div className="artifact-note"><strong>可并行处理</strong><p>{surface.data.parallelGroups.map((group) => group.length + " 个节点").join("、")}</p></div>}
        {surface.data.reportSpec && <div className="artifact-note"><strong>交付规格</strong><p>{REPORT_KIND_LABELS[surface.data.reportSpec.kind]} · {surface.data.reportSpec.audience === "investment_committee" ? "投资决策委员会" : surface.data.reportSpec.audience === "portfolio_manager" ? "投资组合经理" : surface.data.reportSpec.audience === "client" ? "客户" : "研究员"} · {surface.data.reportSpec.depth === "brief" ? "简版" : surface.data.reportSpec.depth === "deep" ? "深度版" : "标准版"} · {surface.data.reportSpec.sections.length} 个受约束章节</p></div>}
        {surface.data.methodPlan && <section className="method-blueprint"><header><strong>专业方法蓝图</strong><span>{surface.data.methodPlan.applications.length} 个章节级 MethodApplication</span></header><p>本次确认会同时冻结以下方法路径；缺少方法输入时章节只能降级，不能由模型补写。</p><div>{surface.data.methodPlan.applications.map((application) => <article key={application.id}><span>{application.id.replace("MA-", "")}</span><div><strong>{application.frameworkIds.join(" + ")}</strong><small>{application.evidenceMethodId} → {application.adjudicationMethodId}</small><p>{application.rationale}</p></div></article>)}</div><footer>{surface.data.methodPlan.exitCondition}</footer></section>}
        <div className="artifact-note"><strong>停止条件</strong><ul>{(surface.data.stopPredicates?.map((item) => item.kind) || surface.data.stopConditions).map((item) => <li key={item}>{item}</li>)}</ul></div>
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
  const [signalRoles, setSignalRoles] = useState<Record<string, SignalRole>>(surface.data.signalRoles || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setStatement(surface.data.statement); setConfidence(surface.data.confidence || "insufficient");
    setConditions(surface.data.changeConditions.join("\n")); setSignalRoles(surface.data.signalRoles || {}); setEditing(false); setError("");
  }, [surface.id, surface.data.statement, surface.data.confidence, surface.data.changeConditions, surface.data.signalRoles]);
  const canEdit = Boolean(artifact && onSave && surface.editableFields.length);
  const signalInputs = surface.data.signalInputs || [];
  const hasSupport = Object.values(signalRoles).includes("support");
  const hasBlock = Object.values(signalRoles).includes("block");
  const isApproved = surface.data.lifecycleStatus === "approved" && Boolean(surface.data.ontologyJudgmentRef);
  async function save() {
    if (!artifact || !onSave) return;
    const changes: Record<string, unknown> = {};
    if (surface.editableFields.includes("statement")) changes.statement = statement.trim();
    if (surface.editableFields.includes("confidence")) changes.confidence = confidence;
    if (surface.editableFields.includes("changeConditions")) changes.changeConditions = conditions.split("\n").map((item) => item.trim()).filter(Boolean);
    if (surface.editableFields.includes("signalRoles")) changes.signalRoles = signalRoles;
    setSaving(true); setError("");
    try { await onSave(artifact.id, artifact.version, changes); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }
  return <article className="artifact-content judgment-artifact">
    <header><span>当前判断 · v{artifact?.version || 1}</span><h2>{surface.data.statement}</h2></header>
    <div className={`judgment-state ${isApproved ? "approved" : ""}`}><strong>{isApproved ? "正式判断已提交" : surface.data.disposition === "abstain" || surface.data.epistemicStatus === "indeterminate" ? "暂不可判断" : "需要研究员复核"}</strong><span>置信边界：{surface.data.confidence || "未评估"}</span></div>
    {!!signalInputs.length && <section className="signal-adjudication"><header><div><h3>证据如何作用于判断</h3><p>这是正式推理链的研究员确认边界。</p></div><span>{signalInputs.length} 条 EvidenceFact</span></header><div>{signalInputs.map((input, index) => {
      const role = signalRoles[input.evidenceFactRef] || "context";
      return <article key={input.evidenceFactRef}><div><strong>F{index + 1}</strong><span>{input.evidenceRoles.length ? input.evidenceRoles.join(" · ") : "通用事实"}</span></div><p>{input.statement}</p>{editing && surface.editableFields.includes("signalRoles") ? <label>证据作用<select aria-label={`证据 ${index + 1} 的作用`} value={role} onChange={(event) => setSignalRoles((current) => ({ ...current, [input.evidenceFactRef]: event.target.value as SignalRole }))}><option value="support">支持</option><option value="weaken">削弱</option><option value="context">背景</option><option value="block">阻断</option></select></label> : <i className={`signal-role ${role}`}>{role === "support" ? "支持" : role === "weaken" ? "削弱" : role === "block" ? "阻断" : "背景"}</i>}</article>;
    })}</div>{editing && <footer className={hasSupport && !hasBlock ? "ready" : "blocked"}>{hasBlock ? "存在阻断信号：不能形成 supported Judgment。" : hasSupport ? "信号门槛已满足。" : "至少将一条事实确认为支持信号后才能保存。"}</footer>}</section>}
    {surface.data.reasoningRule && <section className="reasoning-rule"><header><h3>确定性判断门</h3><code>{surface.data.reasoningRule.ruleRef}</code></header><div>{surface.data.reasoningRule.conditions.map((condition) => <p key={condition.id} className={condition.passed ? "passed" : "failed"}><span>{condition.passed ? "✓" : "—"}</span>{condition.label}</p>)}</div></section>}
    {surface.data.reasoningChain && <section className="reasoning-chain"><header><h3>正式推理链</h3><span>已提交 · 可审计</span></header><p><b>EvidenceFact</b><i>→</i><b>Signal × {surface.data.reasoningChain.signalRefs.length}</b><i>→</i><b>Hypothesis</b><i>→</i><b>RuleEvaluation</b><i>→</i><b>Judgment</b></p><small>ReasoningTrace {surface.data.reasoningChain.traceRef.slice(0, 8)}</small></section>}
    {editing ? <div className="artifact-editor">
      {surface.editableFields.includes("statement") && <label>判断表述<textarea value={statement} onChange={(event) => setStatement(event.target.value)} /></label>}
      {surface.editableFields.includes("confidence") && <label>置信边界<select value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="insufficient">证据不足</option></select></label>}
      {surface.editableFields.includes("changeConditions") && <label>改判条件（每行一项）<textarea value={conditions} onChange={(event) => setConditions(event.target.value)} /></label>}
      {error && <p className="inline-error">{error}</p>}<div><button onClick={() => setEditing(false)} disabled={saving}>取消</button><button className="primary-button" onClick={() => void save()} disabled={saving || (signalInputs.length > 0 && (!hasSupport || hasBlock))}>{saving ? "保存中" : "保存新版本"}</button></div>
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
    <header><span>{surface.data.reportSpec ? REPORT_KIND_LABELS[surface.data.reportSpec.kind] : "研究备忘录"} · v{artifact?.version || 1}</span><h2>{surface.title}</h2>{surface.data.reportSpec && <p>{surface.data.reportSpec.audience === "investment_committee" ? "面向投资决策委员会" : surface.data.reportSpec.audience === "portfolio_manager" ? "面向投资组合经理" : surface.data.reportSpec.audience === "client" ? "面向客户" : "面向研究员"} · {surface.data.reportSpec.depth === "brief" ? "简版" : surface.data.reportSpec.depth === "deep" ? "深度版" : "标准版"}</p>}</header>
    {surface.data.publication && <div className={`publication-state ${surface.data.publication.status}`}><strong>{surface.data.publication.status === "published" ? "已由研究员确认发布" : "已核验 · 等待发布确认"}</strong><span>{surface.data.publication.status === "published" && surface.data.publication.publishedAt ? new Date(surface.data.publication.publishedAt).toLocaleString("zh-CN") : "通过审计不等于自动发布"}</span></div>}
    {surface.data.evaluationFreeze && <div className="evaluation-freeze"><div><strong>正式评测输入已冻结</strong><span>报告 v{surface.data.evaluationFreeze.reportArtifactVersion} · 证据包 v{surface.data.evaluationFreeze.evidenceArtifactVersion}</span></div><code>{surface.data.evaluationFreeze.reportHash.slice(0, 19)}…</code><p>冻结哈希只固定评测输入；仍需密封裁决、扰动、独立校准与同证据基线。</p></div>}
    {editing ? <div className="artifact-editor"><label>摘要<textarea className="report-textarea" value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label>表达边界<textarea value={boundary} onChange={(event) => setBoundary(event.target.value)} /></label>{error && <p className="inline-error">{error}</p>}<div><button onClick={() => setEditing(false)} disabled={saving}>取消</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中" : "保存并重新审计"}</button></div></div> : <><div className="report-body"><p>{surface.data.summary}</p></div>{surface.data.qualityEvaluation && <ReportQualityPanel evaluation={surface.data.qualityEvaluation} />}{surface.data.sections && <div className="report-sections">{surface.data.sections.map((section, index) => <section className={`report-section ${section.status}`} key={section.key}><header><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{section.title}</h3><small>{section.status === "ready" ? "已形成" : section.status === "limited" ? "证据受限" : "不适用"}</small></div></header>{!!section.methodApplicationIds?.length && <div className="method-trace"><strong>方法</strong><span>{section.methodApplicationIds.join(" · ")}</span>{!!section.missingInputs?.length && <em>缺口：{section.missingInputs.join("、")}</em>}</div>}{section.modelDraft && <div className="model-draft-trace"><strong>AI 草拟</strong><span>{section.modelDraft.provider} / {section.modelDraft.model}</span><em>已通过事实、数值与引用边界校验</em></div>}{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{!!section.bullets.length && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}{!!section.sourceIds.length && <footer>{section.sourceIds.length} 个可核验来源引用{section.evidenceFactIds?.length ? ` · ${section.evidenceFactIds.length} 条方法输入事实` : ""}</footer>}</section>)}</div>}{surface.data.boundary && <aside><strong>表达边界</strong><p>{surface.data.boundary}</p></aside>}{canEdit && <div className="artifact-edit-bar"><span>摘要修订保留版本记录，并重新运行确定性审计；正式 Claim 与章节证据不能在此绕过。</span><button onClick={() => setEditing(true)}>编辑摘要</button></div>}</>}
  </article>;
}

function ReportQualityPanel({ evaluation }: { evaluation: NonNullable<Extract<UiSurface, { component: "report_editor" }>["data"]["qualityEvaluation"]> }) {
  return <section className="quality-evaluation"><header><div><strong>专业纪律诊断</strong><span className={evaluation.disciplineStatus}>{evaluation.disciplineStatus === "passed" ? "逐项通过" : "需要关注"}</span></div><p>即时检查引用、方法、事实血缘、改判条件与定制边界；不合成“专业总分”。</p></header><div className="quality-metrics">{evaluation.metrics.map((item) => <article key={item.id} className={item.status}><i>{item.status === "passed" ? "✓" : item.status === "attention" ? "!" : "—"}</i><div><strong>{item.label}</strong><p>{item.note}</p></div></article>)}</div><footer className={evaluation.formalResearchValue.status}><strong>正式研究价值 R / U / Δ / S / C</strong><span>{evaluation.formalResearchValue.status === "eligible" ? "已具备运行资格，尚未运行" : "尚不具备正式评测资格"}</span><p>{evaluation.formalResearchValue.claimBoundary}</p>{!!evaluation.formalResearchValue.missingPrerequisites.length && <details><summary>查看缺失的 {evaluation.formalResearchValue.missingPrerequisites.length} 项条件</summary><ul>{evaluation.formalResearchValue.missingPrerequisites.map((item) => <li key={item}>{item}</li>)}</ul></details>}</footer></section>;
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
  "judgment.committed": "研究员确认的判断已写入正式本体",
  "financial.data_ingested": "结构化金融数据已通过口径与来源校验",
  "connector.source_ingested": "来源快照已通过完整性与溯源校验；事实仍需复核",
  "connector.ingestion_rejected": "外部连接器结果未通过摄取边界",
  "connector.evidence_recompute_queued": "新连接器材料已触发证据及下游局部重算",
  "report.model_draft_verified": "模型章节草稿已通过确定性边界校验",
  "report.model_draft_rejected": "模型章节草稿越过边界，已降级为确定性报告",
  "report.quality_diagnostics_completed": "报告专业纪律诊断已完成；正式研究价值仍按独立协议准入",
  "report.published": "研究员确认发布了当前报告版本",
  "report.evaluation_inputs_frozen": "发布版报告与证据包已冻结为正式评测输入",
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
