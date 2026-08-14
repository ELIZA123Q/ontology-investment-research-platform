import { AppShell } from "@/app/components/app-shell";
import { CompanyCaseWorkspace } from "@/app/components/company-case-workspace";

export default async function ResearchPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <AppShell compact><CompanyCaseWorkspace researchCaseId={conversationId} /></AppShell>;
}
