"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
};

type RunStatus = {
  run?: { current_stage: number; status: string };
  progress?: { completed_stage_count: number };
  pending_count?: number;
  summary_ready?: boolean;
  jobs?: Array<{ id: string; status: string; stage: string }>;
};

const STAGE_OPTIONS = [
  { value: 1, label: "范围", supported: true },
  { value: 2, label: "结构", supported: true },
  { value: 3, label: "证据", supported: true },
  { value: 4, label: "判断", supported: true },
  { value: 5, label: "交付", supported: true },
] as const;

const STAGE_SUGGESTIONS: Record<number, string[]> = {
  1: [
    "帮我细化研究范围的时间边界",
    "研究对象需要更精确的界定",
    "补充背景：为什么这个研究问题现在值得关注",
  ],
  2: [
    "补充反证方向：有哪些可能推翻结论的情况",
    "这个判断单元需要哪些关键证据",
    "调整判断单元的拆解粒度",
  ],
  3: [
    "补充最新的财报数据",
    "查一下行业政策的最新动态",
    "这个来源的权威性需要核实",
  ],
  4: [
    "重新判断订单确定性",
    "展开反证分析",
    "这项证据的权重需要调整",
  ],
  5: [
    "生成投资经理版本报告",
    "调整结论措辞的确定度",
    "补充风险提示章节",
  ],
};

const GENERIC_SUGGESTIONS = [
  "补充一下最新的行业数据",
  "重新审视当前判断",
  "展开反证分析",
  "生成研究简报",
];

function chatStorageKey(runId: string): string {
  return `agent-chat:${runId}`;
}

function loadMessages(runId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(chatStorageKey(runId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (m: unknown) =>
            m && typeof m === "object" && (m as ChatMessage).text
        )
      : [];
  } catch {
    return [];
  }
}

function saveMessages(runId: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(
      chatStorageKey(runId),
      JSON.stringify(messages.slice(-40))
    );
  } catch {
    // Ignore storage errors
  }
}

export function AgentChatPanel() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const resolvedRunId = String(params.id || "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [targetStage, setTargetStage] = useState(2);
  const [collapsed, setCollapsed] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    affected: Array<{ label: string; stage: number }>;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load messages on mount and when runId changes
  useEffect(() => {
    setMessages(loadMessages(resolvedRunId));
    setPendingConfirm(null);
  }, [resolvedRunId]);

  // Fetch run status for context-aware suggestions
  useEffect(() => {
    if (!resolvedRunId) return;
    let cancelled = false;
    fetch(`/api/runs/${resolvedRunId}/status`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRunStatus(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [resolvedRunId]);

  // Persist messages
  useEffect(() => {
    saveMessages(resolvedRunId, messages);
  }, [resolvedRunId, messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when not busy
  useEffect(() => {
    if (!busy && !collapsed) {
      inputRef.current?.focus();
    }
  }, [busy, collapsed]);

  // Determine context-aware suggestions
  const suggestions = (() => {
    const stage = runStatus?.run?.current_stage || 0;
    if (stage >= 1 && stage <= 5) {
      const stageSpecific = STAGE_SUGGESTIONS[stage] || [];
      return [...stageSpecific.slice(0, 3)];
    }
    return GENERIC_SUGGESTIONS;
  })();

  // Current stage for display
  const currentStage = runStatus?.run?.current_stage || 0;
  const stageLabel = STAGE_OPTIONS.find((o) => o.value === currentStage)?.label || "";

  // Active jobs indicator
  const activeJob = runStatus?.jobs?.find((j) =>
    ["queued", "running", "retrying"].includes(j.status)
  );
  const activeJobStage = activeJob
    ? STAGE_OPTIONS.find((o) => o.value === (activeJob as any).stage)?.label || ""
    : "";

  const addMessage = useCallback(
    (role: ChatMessage["role"], text: string) => {
      setMessages((prev) => [
        ...prev,
        { role, text, timestamp: new Date().toISOString() },
      ]);
    },
    []
  );

  const handleSend = useCallback(
    async (confirmDownstream = false) => {
      const text = input.trim();
      if (!text || busy || !resolvedRunId) return;

      setBusy(true);
      setPendingConfirm(null);
      addMessage("user", text);
      setInput("");

      try {
        const response = await fetch(`/api/runs/${resolvedRunId}/revise`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target_stage: targetStage,
            instruction: text,
            confirm_downstream_invalidate: confirmDownstream,
          }),
        });
        const result = await response.json();

        if (
          response.status === 409 &&
          result.status === "needs_confirmation"
        ) {
          setPendingConfirm({
            message: result.message || "此操作将作废下游已确认产物",
            affected: (result.affected_downstream || []).map(
              (item: { label?: string; stage?: number; kind?: string }) => ({
                label: item.label || item.kind || String(item.stage || ""),
                stage: item.stage || 0,
              })
            ),
          });
          addMessage(
            "system",
            result.message || "此操作将作废下游已确认产物"
          );
          return;
        }

        if (!response.ok) {
          const error = result.message || result.error || "操作失败";
          addMessage("assistant", error);
          return;
        }

        if (result.status === "unsupported") {
          addMessage("assistant", result.message || "该阶段暂不支持此操作");
          return;
        }

        // Build response with stage link
        const summary = result.revision_summary || result.message || "";
        const stageHref = `/runs/${resolvedRunId}/stages/${targetStage}`;
        const linkedSummary = summary
          ? `${summary}\n\n[查看${STAGE_OPTIONS[targetStage - 1]?.label || ""}阶段 →](${stageHref})`
          : `已更新${STAGE_OPTIONS[targetStage - 1]?.label || ""}阶段产出。[查看详情 →](${stageHref})`;

        addMessage("assistant", linkedSummary);
        router.refresh();
      } catch (error) {
        addMessage(
          "assistant",
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        setBusy(false);
      }
    },
    [
      input,
      busy,
      resolvedRunId,
      targetStage,
      addMessage,
      router,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  if (!resolvedRunId) return null;

  return (
    <>
      {/* Agent Panel */}
      <aside className={`agent-chat-panel${collapsed ? "" : ""}`}>
        {collapsed ? null : (
          <>
            <div className="agent-chat-head">
              <h3>研究助手</h3>
              <button
                type="button"
                className="agent-chat-collapse"
                onClick={() => setCollapsed(true)}
                aria-label="收起对话面板"
                title="收起对话面板"
              >
                ▸
              </button>
            </div>

            {/* Active job indicator */}
            {activeJob ? (
              <div className="agent-chat-job-status">
                <span className="agent-chat-job-dot" />
                <span>
                  Agent 正在执行{activeJobStage}任务…
                </span>
              </div>
            ) : null}

            <div className="agent-chat-messages">
              {messages.length === 0 ? (
                <div className="agent-chat-empty">
                  <div className="agent-chat-empty-icon">💬</div>
                  <p>
                    用自然语言修改研究，助手会更新对应阶段的产出。
                  </p>
                  {stageLabel ? (
                    <p className="agent-chat-empty-context">
                      当前在「{stageLabel}」阶段
                    </p>
                  ) : null}
                  <div className="agent-chat-empty-suggestions">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="agent-chat-suggestion"
                        onClick={() => handleSuggestionClick(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div
                    key={`${msg.role}-${i}`}
                    className={`agent-chat-bubble is-${msg.role}`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.text
                    )}
                  </div>
                ))
              )}
              {busy ? (
                <div className="agent-chat-bubble is-assistant">
                  <span className="agent-typing-indicator">
                    正在处理<span className="dot-pulse">...</span>
                  </span>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <div className="agent-chat-input-area">
              {pendingConfirm ? (
                <div className="notice" style={{ margin: 0 }}>
                  <p>{pendingConfirm.message}</p>
                  {pendingConfirm.affected.length > 0 ? (
                    <p style={{ fontSize: "11px" }}>
                      受影响的阶段：
                      {pendingConfirm.affected
                        .map((a) => a.label)
                        .join("、")}
                    </p>
                  ) : null}
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => handleSend(true)}
                    >
                      确认并执行
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => setPendingConfirm(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}

              <label className="agent-chat-target">
                <span>目标阶段</span>
                <select
                  value={targetStage}
                  disabled={busy}
                  onChange={(e) => setTargetStage(Number(e.target.value))}
                >
                  {STAGE_OPTIONS.map((opt) => (
                    <option
                      key={opt.value}
                      value={opt.value}
                      disabled={!opt.supported}
                    >
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="agent-chat-input-row">
                <textarea
                  ref={inputRef}
                  className="agent-chat-input"
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入指令，Enter 发送，Shift+Enter 换行…"
                  rows={2}
                />
                <button
                  type="button"
                  className="agent-chat-send"
                  disabled={busy || !input.trim()}
                  onClick={() => handleSend(false)}
                  aria-label="发送"
                >
                  {busy ? "…" : "发送"}
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* FAB toggle on medium screens */}
      <button
        type="button"
        className={`agent-chat-fab${collapsed ? "" : " is-hidden"}`}
        onClick={() => setCollapsed(false)}
        aria-label="打开研究助手"
        title="打开研究助手"
      >
        💬
      </button>
    </>
  );
}
