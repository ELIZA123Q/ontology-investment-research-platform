"use client";

import { useLayoutEffect, useRef } from "react";

const MAX_PX = 38;
const MIN_PX = 24;

/** 标题优先单行缩小字号；到最小字号仍放不下再换行，不用省略号截断。 */
export function FitSceneTitle({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.whiteSpace = "nowrap";
      el.style.overflow = "visible";
      let size = MAX_PX;
      el.style.fontSize = `${size}px`;
      while (size > MIN_PX && el.scrollWidth > el.clientWidth + 1) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      if (el.scrollWidth > el.clientWidth + 1) {
        el.style.whiteSpace = "normal";
        el.style.fontSize = `${MIN_PX}px`;
      }
    };

    fit();
    const target = el.parentElement || el;
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => observer.disconnect();
  }, [children]);

  return <h1 ref={ref} className="fit-scene-title">{children}</h1>;
}
