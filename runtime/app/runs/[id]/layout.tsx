import type { ReactNode } from "react";
import { RunChrome } from "@/app/components/run-chrome";

export default function RunLayout({ children }: { children: ReactNode }) {
  return <RunChrome>{children}</RunChrome>;
}
