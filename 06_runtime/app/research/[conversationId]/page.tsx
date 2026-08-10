import { AppShell } from "@/app/components/app-shell";
import { ResearchWorkspace } from "@/app/components/research-workspace";

export default async function ResearchPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <AppShell compact><ResearchWorkspace conversationId={conversationId} /></AppShell>;
}
