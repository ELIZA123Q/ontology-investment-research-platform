import { ObjectSetPanel } from "@/app/components/object-set-panel";
import { RunChrome } from "@/app/components/run-chrome";

export const dynamic = "force-dynamic";

export default async function ObjectSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <>
    <RunChrome runId={id} active="object-set" />
    <ObjectSetPanel runId={id} />
  </>;
}
