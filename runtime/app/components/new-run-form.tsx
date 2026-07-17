"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function NewRunForm() {
  const [question, setQuestion] = useState("");
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
      body: JSON.stringify({ question, domain, package_path: packagePath || null }),
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
        />
      </div>
      <div className="field">
        <label>知识覆盖领域</label>
        <select value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="semiconductor">半导体（正式支持）</option>
          <option value="general">其他领域（知识覆盖不足）</option>
        </select>
      </div>
      <div className="field">
        <label>绑定正式样例实例图（可选）</label>
        <select value={packagePath} onChange={(e) => setPackagePath(e.target.value)}>
          <option value="">不绑定（由阶段产物合成）</option>
          {packages.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      {domain !== "semiconductor" && <div className="notice">当前只有半导体领域本体，系统会明确标注覆盖不足。</div>}
      {error && <div className="notice error">{error}</div>}
      <button className="button" disabled={busy}>
        {busy ? "正在创建…" : "创建运行并进入工作台 →"}
      </button>
    </form>
  );
}
