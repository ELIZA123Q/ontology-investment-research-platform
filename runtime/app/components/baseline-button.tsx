"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BaselineButton({ runId, completed = false }: { runId: string; completed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function go() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/runs/${runId}/baseline`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) setError(d.error || "生成对照基线失败");
      else router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(/load failed|failed to fetch/i.test(raw)
        ? "连接中断；请刷新查看是否已在后台生成。"
        : raw);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="button-secondary" disabled={busy || completed} onClick={go}>
        {completed ? "对照基线已冻结" : busy ? "正在提交生成…" : "基于当前冻结证据，生成对照基线"}
      </button>
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
