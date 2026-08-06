import type { ReactNode } from "react";
import { ResearchSidebar } from "@/app/components/research-sidebar";
import { AgentChatPanel } from "@/app/components/agent-chat-panel";

export default function RunLayout({ children }: { children: ReactNode }) {
  return (
    <div className="research-workspace-layout">
      <ResearchSidebar />
      <div className="workspace-main">{children}</div>
      <AgentChatPanel />
    </div>
  );
}
