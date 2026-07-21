"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IssueType = "reasoning_jump" | "evidence_mismatch" | "overclaim" | "missing_competing_explanation" | "traceability_gap";
type ReturnStage = "stage_02" | "stage_03" | "stage_04";
type IssueDraft = { issue_type: IssueType; judgment_id: string; description: string; evidence_refs: string; required_action: string; return_stage: ReturnStage };
const emptyIssue = (): IssueDraft => ({ issue_type: "reasoning_jump", judgment_id: "", description: "", evidence_refs: "", required_action: "", return_stage: "stage_04" });

export function IndependentReviewButton({ runId, completed = false }: { runId: string; completed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [attestation, setAttestation] = useState("");
  const [verdict, setVerdict] = useState<"pass" | "rework">("pass");
  const [assessment, setAssessment] = useState("");
  const [strengths, setStrengths] = useState("");
  const [issues, setIssues] = useState<IssueDraft[]>([emptyIssue()]);
  const router = useRouter();

  async function runReview() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/independent-review`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) setError(data.error || "模型独立审阅失败");
      else router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(/load failed|failed to fetch/i.test(raw)
        ? "连接中断；请刷新查看审阅是否仍在后台进行。"
        : raw);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitHumanReview() {
    const selectedIssues = verdict === "rework" ? issues.map((issue) => ({
      ...issue,
      judgment_id: issue.judgment_id.trim() || null,
      description: issue.description.trim(),
      required_action: issue.required_action.trim(),
      evidence_refs: issue.evidence_refs.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
    })) : [];
    if (!reviewer.trim() || attestation.trim().length < 20 || assessment.trim().length < 8 || selectedIssues.some((issue) => !issue.description || !issue.required_action)) {
      setError("请填写审阅者、至少 20 字独立性声明、总体意见；选择「需返工」时还必须填写每项问题和返工动作。");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/runs/${runId}/independent-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "human_controlled", review: {
        reviewer: reviewer.trim(),
        attestation: attestation.trim(),
        verdict,
        overall_assessment: assessment.trim(),
        strengths: strengths.split("\n").map((item) => item.trim()).filter(Boolean),
        issues: selectedIssues,
      } }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || "人类独立审阅登记失败");
    else router.refresh();
    setBusy(false);
  }

  function updateIssue(index: number, patch: Partial<IssueDraft>) {
    setIssues(issues.map((issue, itemIndex) => itemIndex === index ? { ...issue, ...patch } : issue));
  }

  return <div className="independent-review-actions">
    <button type="button" className="button-secondary" disabled={busy || completed} onClick={runReview}>
      {completed ? "独立审阅已生成" : busy ? "独立审阅中…" : "运行模型独立审阅"}
    </button>
    {!completed ? <button type="button" className="button-quiet" disabled={busy} onClick={() => setOpen((value) => !value)}>{open ? "收起人类审阅" : "登记人类独立审阅"}</button> : null}
    {open && !completed ? <div className="card human-review-form">
      <p className="muted">必须由未参与「判断」阶段产出的人独立核查。系统会冻结被审阅稿的内容指纹，并保留审阅者标识和利益冲突声明；这不是“自己点一下通过”。</p>
      <div className="source-form-grid">
        <div className="field"><label>审阅者标识</label><input value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></div>
        <div className="field"><label>审阅结论</label><select value={verdict} onChange={(event) => setVerdict(event.target.value as "pass" | "rework")}><option value="pass">通过</option><option value="rework">需返工</option></select></div>
        <div className="field source-wide"><label>独立性与利益冲突声明（至少 20 字）</label><textarea value={attestation} onChange={(event) => setAttestation(event.target.value)} /></div>
        <div className="field"><label>总体意见</label><textarea value={assessment} onChange={(event) => setAssessment(event.target.value)} /></div>
        <div className="field"><label>优点（每行一条）</label><textarea value={strengths} onChange={(event) => setStrengths(event.target.value)} /></div>
      </div>
      {verdict === "rework" ? <div>{issues.map((issue, index) => <div className="card" key={index} style={{ marginTop: 10 }}>
        <div className="panel-title"><strong>问题 {index + 1}</strong>{issues.length > 1 ? <button type="button" className="button-quiet" onClick={() => setIssues(issues.filter((_, itemIndex) => itemIndex !== index))}>删除</button> : null}</div>
        <div className="source-form-grid">
          <div className="field"><label>问题类型</label><select value={issue.issue_type} onChange={(event) => updateIssue(index, { issue_type: event.target.value as IssueType })}><option value="reasoning_jump">推理跳跃</option><option value="evidence_mismatch">证据错配</option><option value="overclaim">结论越界</option><option value="missing_competing_explanation">遗漏竞争解释</option><option value="traceability_gap">追溯缺口</option></select></div>
          <div className="field"><label>退回阶段</label><select value={issue.return_stage} onChange={(event) => updateIssue(index, { return_stage: event.target.value as ReturnStage })}><option value="stage_02">结构</option><option value="stage_03">证据</option><option value="stage_04">判断</option></select></div>
          <div className="field"><label>判断编号（可空）</label><input value={issue.judgment_id} onChange={(event) => updateIssue(index, { judgment_id: event.target.value })} /></div>
          <div className="field"><label>相关证据编号（逗号分隔）</label><input value={issue.evidence_refs} onChange={(event) => updateIssue(index, { evidence_refs: event.target.value })} /></div>
          <div className="field"><label>问题描述</label><textarea value={issue.description} onChange={(event) => updateIssue(index, { description: event.target.value })} /></div>
          <div className="field"><label>要求动作</label><textarea value={issue.required_action} onChange={(event) => updateIssue(index, { required_action: event.target.value })} /></div>
        </div>
      </div>)}<button type="button" className="button-secondary" onClick={() => setIssues([...issues, emptyIssue()])}>＋ 添加问题</button></div> : null}
      <button type="button" className="button" disabled={busy} onClick={submitHumanReview}>{busy ? "正在冻结审阅记录…" : "生成待确认的人类独立审阅"}</button>
    </div> : null}
    {error ? <div className="notice error">{error}</div> : null}
  </div>;
}
