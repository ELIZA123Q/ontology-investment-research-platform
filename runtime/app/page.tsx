import { listRuns, radarBundle } from "@/adapters/db";
import { RadarDashboard } from "@/app/components/radar-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  const radar = radarBundle();
  const runs = listRuns();
  return <RadarDashboard
    initialEvents={radar.events}
    initialImpacts={radar.impacts}
    initialWorkItems={radar.pending_work_items}
    initialLastRefreshedAt={radar.last_refreshed_at}
    runs={runs}
  />;
}
