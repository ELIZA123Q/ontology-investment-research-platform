"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const STAGE_OPTIONS = [
  { value: 1, label: "01 问题定义", supported: true },
  { value: 2, label: "02 判断结构", supported: true },
  { value: 3, label: "03 来源与证据", supported: false },
  { value: 4, label: "04 判断裁决", supported: true },
  { value: 5, label: "05 研究表达", supported: false },
] as const;

function defaultStageForActive(active: string) {
  switch (active) {
    case "scope": return 1;
    case "structure": return 2;
    case "evidence": return 3;
    case "judgment": return 4;
    case "delivery": return 5;
    default: return 2;
  }
}

type ChatItem = {
  role: "user" | "assistant" | "system";
  text: string;
};

export function RunRevisePanel({ runId, active }: { runId: string; active: string }) {
  const router = useRouter();
  const sceneDefault = useMemo(() => defaultStageForActive(active), [active]);
  const [open, setOpen] = useState(false);
  const [targetStage, setTargetStage] = useState(sceneDefault);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    affected: Array<{ label: string; stage: number }>;
  } | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);

  useEffect(() => {
    setTargetStage(sceneDefault);
  }, [sceneDefault]);

  const supported = STAGE_OPTIONS.find((item) => item.value === targetStage)?.supported ?? false;

  async function submit(confirmDownstream = false) {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setPendingConfirm(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    try {
      const response = await fetch(`/api/runs/${runId}/revise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_stage: targetStage,
          instruction: text,
          confirm_downstream_invalidate: confirmDownstream,
        }),
      });
      const result = await response.json();
      if (response.status === 409 && result.status === "needs_confirmation") {
        setPendingConfirm({
          message: result.message || "改动将作废下游已确认产物",
          affected: (result.affected_downstream || []).map((item: any) => ({
            label: item.label || item.kind,
            stage: item.stage,
          })),
        });
        setMessages((prev) => [...prev, { role: "system", text: result.message }]);
        return;
      }
      if (!response.ok) {
        const error = result.message || result.error || "改稿失败";
        setMessages((prev) => [...prev, { role: "assistant", text: error }]);
        return;
      }
      if (result.status === "unsupported") {
        setMessages((prev) => [...prev, { role: "assistant", text: result.message }]);
        return;
      }
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: result.revision_summary
          || (targetStage === 1
            ? "已更新研究范围，请在范围页审阅后确认。"
            : targetStage === 2
              ? "已更新判断结构，请在结构页审阅后确认。"
              : "已更新判断裁决，请在判断页审阅后确认。"),
      }]);
      setInstruction("");
      router.refresh();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: error instanceof Error ? error.message : String(error),
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`run-revise-dock ${open ? "is-open" : ""}`}>
      {open ? (
        <section className="run-revise-panel" aria-label="自然语言改稿">
          <header className="run-revise-head">
            <div>
              <strong>改稿</strong>
              <span>自然语言修改阶段产物</span>
            </div>
            <button type="button" className="button-quiet" onClick={() => setOpen(false)}>收起</button>
          </header>
          <label className="run-revise-target">
            <span>目标阶段</span>
            <select
              value={targetStage}
              disabled={busy}
              onChange={(event) => setTargetStage(Number(event.target.value))}
            >
              {STAGE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}{item.supported ? "" : "（未开通）"}
                </option>
              ))}
            </select>
          </label>
          {!supported ? (
            <p className="muted run-revise-hint">该阶段自然语言改稿尚未开通；当前支持 Stage01 研究范围、Stage02 判断结构与 Stage04 判断裁决。</p>
          ) : targetStage === 1 ? (
            <p className="muted run-revise-hint">例如：把截止时点改到 2025 年底；或排除 AI 应用层公司。</p>
          ) : targetStage === 4 ? (
            <p className="muted run-revise-hint">例如：把 JU-02 结论收紧为暂不可判断；把 EV-3 调整为反证；补一条改判条件。</p>
          ) : (
            <p className="muted run-revise-hint">例如：把 JU-03 拆成成本传导与估值影响两个单元；或收紧反证方向。</p>
          )}
          <div className="run-revise-log">
            {messages.length === 0 ? <p className="muted">改稿记录会显示在这里。</p> : null}
            {messages.map((item, index) => (
              <div key={`${item.role}-${index}`} className={`run-revise-bubble is-${item.role}`}>
                {item.text}
              </div>
            ))}
          </div>
          {pendingConfirm ? (
            <div className="notice run-revise-confirm">
              <p>{pendingConfirm.message}</p>
              <div className="actions">
                <button type="button" className="button" disabled={busy} onClick={() => submit(true)}>确认并改稿</button>
                <button type="button" className="button-secondary" disabled={busy} onClick={() => setPendingConfirm(null)}>取消</button>
              </div>
            </div>
          ) : null}
          <textarea
            className="run-revise-input"
            value={instruction}
            disabled={busy || !supported}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={supported ? "用一句话说明要怎么改…" : "该阶段尚未开通"}
            rows={3}
          />
          <button
            type="button"
            className="button"
            disabled={busy || !supported || !instruction.trim()}
            onClick={() => submit(false)}
          >
            {busy ? "正在改稿…" : "提交改稿"}
          </button>
        </section>
      ) : (
        <button type="button" className="run-revise-fab" onClick={() => setOpen(true)}>
          改稿
        </button>
      )}
    </div>
  );
}
