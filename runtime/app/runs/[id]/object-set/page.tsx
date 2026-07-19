import { ObjectSetPanel } from "@/app/components/object-set-panel";
import { RunNav } from "@/app/components/run-nav";

export const dynamic = "force-dynamic";

export default async function ObjectSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <>
    <RunNav runId={id} active="object-set" />
    <ObjectSetPanel runId={id} />
  </>;
}
