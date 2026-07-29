import Link from "next/link";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  children?: ReactNode;
  className?: string;
};

/** 统一任务型空态：说明缺什么、下一步去哪。 */
export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  children,
  className = "",
}: EmptyStateProps) {
  return (
    <section className={`card empty-state ${className}`.trim()}>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {children}
      {actionHref && actionLabel ? (
        <Link className="button" href={actionHref}>{actionLabel}</Link>
      ) : null}
    </section>
  );
}
