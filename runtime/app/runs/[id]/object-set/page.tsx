import { ObjectSetPanel } from "@/app/components/object-set-panel";

export const dynamic = "force-dynamic";

export default async function ObjectSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ObjectSetPanel runId={id} />;
}
