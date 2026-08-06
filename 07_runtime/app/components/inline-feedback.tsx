"use client";

import type { ReactNode } from "react";

type InlineFeedbackProps = {
  message?: string | null;
  tone?: "status" | "error" | "progress";
  children?: ReactNode;
};

/** 异步反馈区：status 用 polite live region，error 用 alert。 */
export function InlineFeedback({
  message,
  tone = "status",
  children,
}: InlineFeedbackProps) {
  if (!message && !children) return null;
  if (tone === "error") {
    return (
      <div className="notice error inline-feedback" role="alert">
        {message ? <p>{message}</p> : null}
        {children}
      </div>
    );
  }
  return (
    <div
      className={`notice inline-feedback${tone === "progress" ? " generation-progress" : ""}`}
      role="status"
      aria-live="polite"
    >
      {message ? <p>{message}</p> : null}
      {children}
    </div>
  );
}
