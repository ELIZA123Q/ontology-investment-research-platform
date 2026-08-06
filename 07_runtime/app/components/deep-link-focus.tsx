"use client";

import { useEffect } from "react";

export function DeepLinkFocus({ id }: { id?: string }) {
  useEffect(() => {
    if (!id) return;
    const target = document.getElementById(`focus-${id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [id]);
  return null;
}

