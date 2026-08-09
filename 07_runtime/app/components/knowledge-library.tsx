"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "@/src/contracts";
import type { LibraryItem, LibraryView } from "@/src/ui/view-models";
import { apiRequest } from "@/app/components/client-api";
import { ArrowIcon, CloseIcon, LibraryIcon, SearchIcon } from "@/app/components/icons";

const kindLabels: Record<string, string> = {
  ontology: "本体", dictionary: "词典", method: "研究方法", rule: "规则", source_profile: "来源规范",
  data_mapping: "数据映射", prompt: "提示程序", template: "模板", workflow: "工作流", case: "案例",
  eval_case: "评测案例", failure_pattern: "失败模式", skill: "技能", temporal_fact: "时态事实",
  preference: "偏好", topic_index: "主题索引",
};

function renderValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join("；");
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join("；");
}

export function KnowledgeLibrary() {
  const [view, setView] = useState<LibraryView>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<LibraryItem>();
  const [researchItem, setResearchItem] = useState<LibraryItem>();
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const goalRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void apiRequest<LibraryView>("/vnext/knowledge").then((next) => { setView(next); setSelected(next.items[0]); }).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const kinds = useMemo(() => [...new Set((view?.items || []).map((item) => item.ref.kind))], [view]);
  const filtered = useMemo(() => (view?.items || []).filter((item) => {
    const matchesKind = kind === "all" || item.ref.kind === kind;
    const haystack = `${item.title} ${item.summary} ${item.ref.identityKey || ""}`.toLowerCase();
    return matchesKind && haystack.includes(query.trim().toLowerCase());
  }), [kind, query, view]);

  function openResearch(item: LibraryItem) {
    setResearchItem(item);
    setGoal(`基于已发布知识“${item.title}”，研究：`);
    requestAnimationFrame(() => goalRef.current?.focus());
  }

  async function startResearch() {
    if (!researchItem || !goal.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const title = goal.trim().length > 34 ? `${goal.trim().slice(0, 34)}…` : goal.trim();
      const conversation = await apiRequest<Conversation>("/vnext/conversations", { method: "POST", body: JSON.stringify({ title }) });
      await apiRequest(`/vnext/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ content: goal.trim(), pinnedAssetRefs: [researchItem.ref] }) });
      window.location.assign(`/research/${conversation.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return <main className="library-page" id="main-content">
    <header className="page-intro"><span>已发布知识</span><h1>研究员知识库</h1><p>这里只展示当前正式 Release 中可被研究上下文引用的知识。候选、审批和内部治理不会出现在这里。</p><div className="release-chip">Release {view?.releaseFingerprint ? view.releaseFingerprint.slice(0, 10) : "加载中"}</div></header>
    <div className="library-layout">
      <section className="library-browser">
        <div className="library-toolbar"><label><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、说明或稳定标识" /></label><select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="知识类型"><option value="all">全部类型</option>{kinds.map((item) => <option value={item} key={item}>{kindLabels[item] || item}</option>)}</select></div>
        <div className="library-list">{!view ? <div className="skeleton-list"><i/><i/><i/></div> : filtered.length ? filtered.map((item) => <button className={selected?.ref.assetId === item.ref.assetId ? "active" : ""} key={`${item.ref.assetId}:${item.ref.version}`} onClick={() => setSelected(item)}><span className="knowledge-kind">{kindLabels[item.ref.kind] || item.ref.kind}</span><strong>{item.title}</strong><p>{item.summary || "此知识项以结构化内容发布。"}</p><small>v{item.ref.version} · {item.ref.identityKey || item.ref.assetId.slice(0, 12)}</small></button>) : <div className="empty-state"><LibraryIcon /><strong>没有匹配的已发布知识</strong><p>调整搜索条件，或等待治理流程发布新的 Revision。</p></div>}</div>
      </section>
      <aside className="knowledge-detail">{selected ? <>
        <header><span>{kindLabels[selected.ref.kind] || selected.ref.kind}</span><h2>{selected.title}</h2><p>{selected.summary || "已通过知识发布流程进入当前基线。"}</p><button className="primary-button" onClick={() => openResearch(selected)}>用于新研究<ArrowIcon /></button></header>
        <dl><div><dt>版本</dt><dd>v{selected.ref.version}</dd></div><div><dt>作用域</dt><dd>全局已发布</dd></div><div><dt>有效时间</dt><dd>{selected.revision.validFrom ? new Date(selected.revision.validFrom).toLocaleDateString("zh-CN") : "长期有效"}</dd></div><div><dt>来源引用</dt><dd>{selected.revision.provenanceRefs.length || 0} 项</dd></div></dl>
        <section><h3>知识内容</h3>{Object.entries(selected.revision.content).filter(([key]) => !["title", "name", "summary", "description"].includes(key)).map(([key, value]) => <div className="knowledge-property" key={key}><span>{key}</span><p>{renderValue(value)}</p></div>)}</section>
        {selected.revision.provenanceRefs.length > 0 && <section><h3>血缘引用</h3><ul className="provenance-list">{selected.revision.provenanceRefs.map((ref) => <li key={ref}>{ref}</li>)}</ul></section>}
      </> : <div className="detail-empty">选择一项知识查看版本与血缘。</div>}</aside>
    </div>

    {researchItem && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setResearchItem(undefined); }}><section className="research-modal" role="dialog" aria-modal="true" aria-labelledby="research-modal-title"><header><div><span>固定已发布知识</span><h2 id="research-modal-title">基于“{researchItem.title}”开始研究</h2></div><button className="icon-button" onClick={() => setResearchItem(undefined)}><CloseIcon /></button></header><p>该版本会作为显式 Context Reference 进入新任务，并继续受 KnowledgeLock 约束。</p><textarea ref={goalRef} value={goal} onChange={(event) => setGoal(event.target.value)} /><div className="modal-actions"><button onClick={() => setResearchItem(undefined)}>取消</button><button className="primary-button" disabled={!goal.trim() || busy} onClick={() => void startResearch()}>{busy ? "正在创建" : "开始研究"}<ArrowIcon /></button></div>{error && <p className="inline-error">{error}</p>}</section></div>}
  </main>;
}
