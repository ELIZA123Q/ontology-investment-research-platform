import { redirect } from "next/navigation";

export default function LegacyInternalKnowledgePage() {
  redirect("/admin/knowledge");
}
