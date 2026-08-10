import { notFound } from "next/navigation";
import { KnowledgeAdminConsole } from "@/app/components/knowledge-admin";

export const dynamic = "force-dynamic";

export default function AdminKnowledgePage() {
  if (process.env.VNEXT_INTERNAL_UI_ENABLED !== "true") notFound();
  return <KnowledgeAdminConsole />;
}
