import Link from "next/link";

export type StageException = {
  title: string;
  summary?: string;
  items?: string[];
  href?: string;
  actionLabel?: string;
  tone?: "blocking" | "limiting";
};

/** 只用于会改变当前人工决策的异常；正常校验结果不进入主视图。 */
export function StageExceptionNotice({ exception }: { exception: StageException | null | undefined }) {
  if (!exception) return null;
  const items = Array.from(new Set((exception.items || []).filter(Boolean))).slice(0, 5);
  return (
    <section className={`stage-exception is-${exception.tone || "blocking"}`} role="status">
      <div>
        <span>{exception.tone === "limiting" ? "当前限制" : "确认前需处理"}</span>
        <strong>{exception.title}</strong>
        {exception.summary ? <p>{exception.summary}</p> : null}
        {items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      </div>
      {exception.href ? <Link className="button" href={exception.href}>{exception.actionLabel || "去处理 →"}</Link> : null}
    </section>
  );
}
