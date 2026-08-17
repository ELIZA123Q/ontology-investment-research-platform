"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, formatRelativeTime, taskStageText } from "@/app/components/client-api";
import type { Artifact, Task } from "@/src/contracts";

interface CaseData { id: string; version: number; companyCode: string; companyName: string; asOf: string; researchQuestion: string; primaryLens: string; counterLens: string; status: string; updatedAt: string; bundleId?: string }
interface SpineItem { id: string; status: "ready" | "limited" | "blocked" | "waiting_approval" | "invalidated"; artifactIds: string[] }
interface Snapshot {
  researchCase: CaseData;
  runtime: { task: Task | null; artifacts: Artifact[]; approvals: Array<{ id: string; kind: string; prompt: string }>; events: Array<{ id: string; type: string; createdAt: string; payload: unknown }>; nodes: Array<{ id: string; title: string; status: string }> };
  decisionSpine: SpineItem[];
  intervention: { approvalId: string; prompt: string; command: string; label: string } | null;
  taskOutcome: { value: string; label: string } | null;
  artifactPermissions: Record<string, string[]>;
}

const spineLabels: Record<string, { title: string; note: string }> = {
  scope: { title: "范围与问题图", note: "主体、截止日与正反 Lens" }, evidence: { title: "证据篮子", note: "来源、事实与关键缺口" },
  business_and_kpi: { title: "商业模式 / KPI", note: "经营变量与财务桥" }, financial_model: { title: "财务模型", note: "标准化、三表与审计" },
  judgment: { title: "判断与反证", note: "命题、边界与改判条件" }, valuation: { title: "估值边界", note: "方法、输入与敏感性" }, report: { title: "报告与审计", note: "正式交付与来源附录" },
};
const productionSpineIds = new Set(["scope", "evidence", "financial_model", "judgment", "report"]);

export function CompanyCaseWorkspace({ researchCaseId }: { researchCaseId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState("scope");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [materialOpen, setMaterialOpen] = useState(false);
  const [material, setMaterial] = useState({ uri: "", title: "", publisherId: "", publishedAt: "", sourceType: "primary", locator: "", quote: "", permissionConfirmed: true });

  const refresh = useCallback(async () => setSnapshot(await apiRequest<Snapshot>(`/api/v2/research-cases/${researchCaseId}`)), [researchCaseId]);
  useEffect(() => { void refresh().catch((reason) => setError(String(reason))); }, [refresh]);
  useEffect(() => {
    const events = new EventSource(`/api/v2/research-cases/${researchCaseId}/events`);
    events.onmessage = () => void refresh();
    return () => events.close();
  }, [researchCaseId, refresh]);

  async function command(type: string, payload: Record<string, unknown> = {}) {
    if (!snapshot) return; setBusy(true); setError("");
    try {
      await apiRequest(`/api/v2/research-cases/${researchCaseId}/commands`, { method: "POST", body: JSON.stringify({ type, expectedVersion: snapshot.researchCase.version, idempotencyKey: `${type}:${snapshot.researchCase.version}:${crypto.randomUUID()}`, payload }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const artifactsById = useMemo(() => new Map(snapshot?.runtime.artifacts.map((item) => [item.id, item]) || []), [snapshot]);
  const visibleSpine = snapshot?.decisionSpine.filter((item) => productionSpineIds.has(item.id)) || [];
  const selectedSpine = visibleSpine.find((item) => item.id === selected);
  const selectedArtifacts = selectedSpine?.artifactIds.map((id) => artifactsById.get(id)).filter(Boolean) as Artifact[] | undefined;

  if (!snapshot) return <main className="v2-workspace loading"><p>{error || "正在装配公司研究上下文…"}</p></main>;
  const { researchCase, runtime } = snapshot;
  const intervention = snapshot.intervention;

  return <main className="v2-workspace">
    <header className="v2-case-header"><div><a href="/">← 返回研究首页</a><span>{researchCase.companyCode} · 截止 {researchCase.asOf.slice(0, 10)}</span><h1>{researchCase.companyName}</h1><p>{researchCase.researchQuestion}</p><div className="v2-lens-pair"><b>主 Lens · {lensLabel(researchCase.primaryLens)}</b><b>反 Lens · {lensLabel(researchCase.counterLens)}</b>{researchCase.bundleId && <b>知识包 · {researchCase.bundleId.slice(7, 19)}</b>}</div></div><div className="v2-case-state"><small>{snapshot.taskOutcome ? "Task Outcome" : "当前结果"}</small><strong>{snapshot.taskOutcome?.label || (runtime.task ? taskStageText(runtime.task) : "等待建立任务")}</strong><span>v{researchCase.version} · {formatRelativeTime(researchCase.updatedAt)}</span></div><nav><button onClick={() => setMaterialOpen(!materialOpen)}>＋ 补充证据</button>{runtime.task?.status === "failed" && <button onClick={() => void command("retry")}>恢复执行</button>}<button className="danger" onClick={() => void command("cancel")}>结束本轮</button></nav></header>

    {intervention && <section className="v2-intervention"><div><span>需要你的判断</span><strong>{intervention.prompt}</strong><p>系统会停在这里，直到你确认当前制品和边界。</p></div><button disabled={busy} onClick={() => void command(intervention.command)}>{busy ? "处理中…" : intervention.label}</button></section>}
    {error && <p className="v2-error workspace-error" role="alert">{error}</p>}

    <section className="v2-spine" aria-label="业绩更新决策脊柱">{visibleSpine.map((item, index) => <button className={selected === item.id ? "active" : ""} key={item.id} onClick={() => setSelected(item.id)}><i>{index + 1}</i><span><strong>{spineLabels[item.id].title}</strong><small>{item.id === "financial_model" ? "正式披露财务读数；模型更新仍处于评估范围" : spineLabels[item.id].note}</small></span><b className={item.status}>{statusLabel(item.status)}</b></button>)}</section>

    <section className="v2-case-body">
      <article className="v2-artifact-panel"><header><div><span>{selected.toUpperCase()}</span><h2>{spineLabels[selected].title}</h2><p>{spineLabels[selected].note}</p></div><small>{selectedArtifacts?.length || 0} 个制品</small></header>
        {!selectedArtifacts?.length && <div className="v2-empty"><strong>这个判断单元还没有制品</strong><p>系统会保留 limited 或 blocked，而不是用通用文本补齐。</p></div>}
        {selectedArtifacts?.map((artifact) => <ArtifactCard key={`${artifact.id}:${artifact.version}`} artifact={artifact} editableFields={snapshot.artifactPermissions[artifact.id] || []} command={command}/>)}
      </article>
      <aside className="v2-trace"><header><span>审计时间线</span><strong>发生了什么</strong></header>{runtime.events.slice(-12).reverse().map((event) => <div key={event.id}><i/><p><strong>{eventLabel(event.type)}</strong><small>{formatRelativeTime(event.createdAt)}</small></p></div>)}</aside>
    </section>

    {materialOpen && <div className="v2-modal-backdrop"><form className="v2-material-modal" onSubmit={(event) => { event.preventDefault(); void command("attach_material", material).then(() => { setMaterialOpen(false); setMaterial({ uri: "", title: "", publisherId: "", publishedAt: "", sourceType: "primary", locator: "", quote: "", permissionConfirmed: true }); }); }}><header><div><span>LOCATED SOURCE</span><h2>补充可定位证据</h2></div><button type="button" onClick={() => setMaterialOpen(false)}>×</button></header><label>来源标题<input required value={material.title} onChange={(event) => setMaterial({ ...material, title: event.target.value })}/></label><label>公开链接<input required type="url" value={material.uri} onChange={(event) => setMaterial({ ...material, uri: event.target.value })}/></label><div><label>发布主体<input value={material.publisherId} onChange={(event) => setMaterial({ ...material, publisherId: event.target.value })}/></label><label>发布日期<input type="date" value={material.publishedAt} onChange={(event) => setMaterial({ ...material, publishedAt: event.target.value })}/></label><label>来源类型<select value={material.sourceType} onChange={(event) => setMaterial({ ...material, sourceType: event.target.value })}><option value="primary">一手来源</option><option value="secondary">二手来源</option></select></label></div><label>原文定位<input required placeholder="页码、章节或段落" value={material.locator} onChange={(event) => setMaterial({ ...material, locator: event.target.value })}/></label><label>原文摘录<textarea required rows={7} value={material.quote} onChange={(event) => setMaterial({ ...material, quote: event.target.value })}/></label><label className="check"><input type="checkbox" checked={material.permissionConfirmed} onChange={(event) => setMaterial({ ...material, permissionConfirmed: event.target.checked })}/>我确认研究使用权限和摘录准确性</label><footer><button type="button" onClick={() => setMaterialOpen(false)}>取消</button><button disabled={busy}>冻结并提交证据</button></footer></form></div>}
  </main>;
}

function ArtifactCard({ artifact, editableFields, command }: { artifact: Artifact; editableFields: string[]; command: (type: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const data = artifact.data as Record<string, unknown>;
  const editableField = editableFields.includes("summary") ? "summary" : editableFields.includes("statement") ? "statement" : editableFields.includes("changeConditions") ? "changeConditions" : null;
  const rawInitial = editableField ? data[editableField] : "";
  const initial = Array.isArray(rawInitial) ? rawInitial.map(String).join("\n") : String(rawInitial || "");
  const [value, setValue] = useState(initial);
  const changedValue = editableField === "changeConditions" ? value.split("\n").map((item) => item.trim()).filter(Boolean) : value;
  return <section className="v2-artifact-card"><header><div><span>{artifact.kind}</span><strong>{artifact.title}</strong></div><small className={artifact.status}>{artifact.status} · v{artifact.version}</small></header><ArtifactSummary artifact={artifact}/>{editableField && <div className="v2-governed-editor"><label>{editableField === "changeConditions" ? "改判条件（每行一条）" : editableField === "statement" ? "判断表述" : "报告摘要"}<textarea rows={5} value={value} onChange={(event) => setValue(event.target.value)}/></label><button onClick={() => void command(artifact.kind === "judgment" ? "revise_judgment" : "revise_report", { artifactId: artifact.id, artifactExpectedVersion: artifact.version, changes: { [editableField]: changedValue } })}>保存新版本并重新审计</button></div>}<details><summary>查看结构化审计数据</summary><pre>{JSON.stringify(data, null, 2).slice(0, 6000)}</pre></details></section>;
}

function ArtifactSummary({ artifact }: { artifact: Artifact }) {
  const data = artifact.data as Record<string, unknown>;
  if (artifact.kind === "research_problem_graph") {
    const nodes = Array.isArray(data.nodes) ? data.nodes as Array<Record<string, unknown>> : [];
    const units = nodes.filter((item) => item.type === "judgment_unit");
    return <div className="v2-artifact-summary"><p><strong>{units.length}</strong><span>必需判断单元</span></p><p><strong>{nodes.filter((item) => item.type === "evidence_requirement").length}</strong><span>证据要求</span></p><p><strong>{(data.taskMotifRefs as string[] || []).join(" · ") || "待装配"}</strong><span>任务图来源</span></p></div>;
  }
  if (artifact.kind === "research_plan") {
    const nodes = Array.isArray(data.nodes) ? data.nodes as Array<Record<string, unknown>> : [];
    const frontiers = new Set(nodes.map((item) => String((item.frontierRef as Record<string, unknown> | undefined)?.judgmentUnitRef || "")).filter(Boolean));
    return <div className="v2-artifact-summary"><p><strong>{nodes.length}</strong><span>可执行节点</span></p><p><strong>{frontiers.size}</strong><span>可局部重算单元</span></p><p><strong>可并行 / 可阻断</strong><span>计划形态</span></p></div>;
  }
  const statement = String(data.statement || data.summary || data.boundary || "");
  const gaps = Array.isArray(data.evidenceGaps) ? data.evidenceGaps : Array.isArray(data.gaps) ? data.gaps : [];
  return <div className="v2-artifact-narrative">{statement && <p>{statement}</p>}{gaps.length > 0 && <p><strong>当前缺口：</strong>{gaps.map(String).join("；")}</p>}{!statement && gaps.length === 0 && <p>该制品已结构化保存，可展开审计数据查看来源与方法。</p>}</div>;
}

function statusLabel(status: SpineItem["status"]) { return ({ ready: "就绪", limited: "待完善", blocked: "已阻断", waiting_approval: "待确认", invalidated: "已失效" } as const)[status]; }
function eventLabel(type: string) { const labels: Record<string, string> = { "research_case.created": "研究案例已建立", "plan.proposed": "研究计划已形成", "plan.confirmed": "研究计划已确认", "task.started": "执行已开始", "evidence.promoted": "证据已进入评估", "approval.requested": "请求研究员确认", "artifact.edited": "制品生成新版本", "task.settled": "本轮执行已结算" }; return labels[type] || type.replaceAll(".", " · "); }
function lensLabel(lens: string) { return ({ fundamental: "基本面", growth: "成长", quality: "质量", value_valuation: "价值与估值", risk_first: "风险优先", expectation_gap: "预期差" } as Record<string, string>)[lens] || lens; }
