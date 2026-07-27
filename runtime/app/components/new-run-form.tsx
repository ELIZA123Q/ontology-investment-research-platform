"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function packageLabel(path: string) {
  const normalized = path.toLowerCase();
  if (normalized.includes("memory-cycle")) return "存储周期研究样例";
  if (normalized.includes("us-controls-localization")) return "出口管制与国产替代研究样例";
  const name = path.split("/").filter(Boolean).at(-1) || "预置研究样例";
  return name.replace(/[-_]+/g, " ");
}

export function NewRunForm({ initialQuestion = "", experienceCaseId = "" }: { initialQuestion?: string; experienceCaseId?: string }) {
  const [question, setQuestion] = useState(initialQuestion);
  const [domain, setDomain] = useState("semiconductor");
  const [packagePath, setPackagePath] = useState("");
  const [packages, setPackages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setPackages(d.example_packages || []))
      .catch(() => setPackages([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, domain, package_path: packagePath || null, experience_case_id: experienceCaseId || null }),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error);
      setBusy(false);
      return;
    }
    router.push(`/runs/${d.id}`);
  }

  return (
    <form className="card form-card" onSubmit={submit}>
      <div className="field">
        <label>研究问题</label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="例如：未来 6—12 个月，存储芯片供需是否会由过剩转向平衡？"
          required
          readOnly={Boolean(experienceCaseId)}
        />
      </div>
      {experienceCaseId && <div className="notice">体验基线 {experienceCaseId}：问题已冻结。创建后会从第一步开始记录真实操作，不做历史回填。</div>}
      <div className="field">
        <label>研究领域</label>
        <select value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="semiconductor">半导体（正式支持）</option>
          <option value="general">其他领域（知识覆盖不足）</option>
        </select>
      </div>
      {packages.length ? (
        <details className="form-advanced-options">
          <summary>高级：从预置研究对象开始</summary>
          <div className="field">
            <label>预置研究对象</label>
            <select value={packagePath} onChange={(e) => setPackagePath(e.target.value)}>
              <option value="">不使用预置对象</option>
              {packages.map((item) => (
                <option key={item} value={item}>
                  {packageLabel(item)}
                </option>
              ))}
            </select>
          </div>
        </details>
      ) : null}
      {domain !== "semiconductor" && <div className="notice">当前只有半导体领域知识库，系统会明确标注覆盖不足。</div>}
      {error && <div className="notice error">{error}</div>}
      <button className="button" disabled={busy}>
        {busy ? "正在创建…" : "创建研究并进入工作台 →"}
      </button>
    </form>
  );
}
