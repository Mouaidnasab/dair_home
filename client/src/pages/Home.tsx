import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

import BatteryCard from "@/components/BatteryCard";
import Header from "@/components/Header";
import EnergyFlowCard from "@/components/EnergyFlowCard";
import ZoneCard from "@/components/ZoneCard";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";

// recharts is the heaviest dependency: load the charts in their own chunks, after the live cards.
const PowerChart = lazy(() => import("@/components/PowerChart"));
const EnergyPanel = lazy(() => import("@/components/EnergyPanel"));

const LIVE_POLL_MS = 60_000;

function Placeholder({ h = "h-40" }: { h?: string }) {
  return <Skeleton className={`w-full rounded-xl ${h}`} />;
}

export default function Home() {
  const { t } = useTranslation();
  const live = usePolling(signal => api.live(signal), LIVE_POLL_MS, []);
  const data = live.data;
  const batteriesBySn = useMemo(() => new Map((data?.batteries ?? []).map(b => [b.sn, b])), [data]);
  const errors = data ? Object.keys(data.collector.errors).length : 0;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background">
      <Header updatedTs={data ? Math.min(...data.systems.map(x => x.updated_ts ?? Infinity)) : null} loading={live.loading} onRefresh={live.refresh} />
      <main className="container flex-1 space-y-4 py-4 sm:py-6">
        {live.error && (
          <Card className="border-destructive">
            <CardContent className="p-3 text-sm text-destructive">
              {t("common.error")}: {live.error}
            </CardContent>
          </Card>
        )}
        {data && !data.collector.enabled && <p className="text-sm text-muted-foreground">{t("common.collector_off")}</p>}
        {errors > 0 && <p className="text-sm text-amber-600">{t("common.collector_errors", { count: errors })}</p>}

        <section className="grid min-w-0 gap-4 lg:grid-cols-2">
          {data ? data.systems.map(sys => <EnergyFlowCard key={sys.system} system={sys} />) : [0, 1].map(i => <Placeholder key={i} h="h-72" />)}
        </section>

        <section className="grid min-w-0 gap-4 md:grid-cols-3">
          {data
            ? data.zones.map(z => (
                <ZoneCard key={z.zone} zone={z} batteries={z.battery_sns.map(sn => batteriesBySn.get(sn)).filter(b => b !== undefined)} />
              ))
            : [0, 1, 2].map(i => <Placeholder key={i} h="h-64" />)}
        </section>

        <section className="grid min-w-0 gap-4 md:grid-cols-2">
          {data ? data.batteries.map(b => <BatteryCard key={b.sn} battery={b} />) : [0, 1].map(i => <Placeholder key={i} />)}
        </section>

        <Suspense fallback={<Placeholder h="h-80" />}>
          <PowerChart />
        </Suspense>
        <Suspense fallback={<Placeholder h="h-96" />}>
          <EnergyPanel />
        </Suspense>
      </main>
    </div>
  );
}
