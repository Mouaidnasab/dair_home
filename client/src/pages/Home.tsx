import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Header from "@/components/Header";
import BatteryCard from "@/components/BatteryCard";
import InverterPanel from "@/components/InverterPanel";
import TrendsCard from "@/components/TrendsCard";
import GridTrendsPanel from "@/components/GridTrendsPanel";
import EnergyDistributionCard from "@/components/EnergyDistributionCard";

import Footer from "@/components/Footer";
import ErrorBanner from "@/components/ErrorBanner";
import GovernmentElectricityCard from "@/components/GovernmentElectricityCard";
import { SkeletonBatteryCard, SkeletonCard } from "@/components/SkeletonCard";
import EnvironmentCard from "@/components/EnvironmentCard";
import PvStatsCard from "@/components/PvStatsCard";
import {
  fetchDashboardData,
  fetchTrendsData,
  fetchGridStats,
  pullNow,
} from "@/lib/api";
import { useCurrency } from "@/contexts/CurrencyContext";
import { toast } from "sonner";

import {
  DashboardData,
  TrendsSeries,
  TimeSeriesPoint,
  GridStats,
} from "@/types/energy";

interface ElectricityInterval {
  startTime: string;
  endTime: string;
  duration: number; // minutes
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { currency } = useCurrency();

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [trendsData, setTrendsData] = useState<TrendsSeries | null>(null);
  const [gridOverview, setGridOverview] = useState<GridStats | null>(null);

  // Loading states
  const [isDashboardLoading, setDashboardLoading] = useState(true);
  const [isGridLoading, setGridLoading] = useState(true);
  const [isTrendsLoading, setTrendsLoading] = useState(true);
  const [firstLoadDone, setFirstLoadDone] = useState(false); // Global first load flag
  const [apiError, setApiError] = useState<string | null>(null);

  // Government electricity (intervals & total hours) — now also needs the viewed date
  const [governmentElectricityIntervals, setGovernmentElectricityIntervals] =
    useState<ElectricityInterval[]>([]);
  const [governmentElectricityHours, setGovernmentElectricityHours] =
    useState(0);

  // -------- Date selection (defaults to Today) --------
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const isViewingToday = useMemo(
    () => sameDay(selectedDate, new Date()),
    [selectedDate],
  );

  // -------- Helpers --------
  const calculateGovernmentElectricityIntervals = (
    timeSeriesData: TimeSeriesPoint[],
  ) => {
    // OLD Logic: Grid power > 0
    // NEW Logic: Grid Voltage > 100 (approx threshold for 220V grid availability)
    const intervals: ElectricityInterval[] = [];
    let current: ElectricityInterval | null = null;
    let totalHours = 0;

    for (let i = 0; i < timeSeriesData.length; i++) {
      const point = timeSeriesData[i];
      // Use voltage to detect presence. 50V is a safe lower bound to avoid noise,
      // but usually it's ~220V. >100V is a solid "ON" signal.
      const gridVoltage = point.gridVoltage || 0;
      const isGridPresent = gridVoltage > 100;

      if (isGridPresent) {
        if (!current) {
          current = {
            startTime: point.timestamp,
            endTime: point.timestamp,
            duration: 0,
          };
        } else {
          current.endTime = point.timestamp;
        }
      } else if (current) {
        const start = new Date(current.startTime);
        const end = new Date(current.endTime);
        const mins = Math.round(
          (end.getTime() - start.getTime()) / (1000 * 60),
        );
        if (mins > 0) {
          current.duration = mins;
          intervals.push(current);
          totalHours += mins / 60;
        }
        current = null;
      }
    }

    // If interval reaches end of series
    if (current) {
      const start = new Date(current.startTime);
      const end = new Date(current.endTime);
      const mins = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
      if (mins > 0) {
        current.duration = mins;
        intervals.push(current);
        totalHours += mins / 60;
      }
    }

    setGovernmentElectricityIntervals(intervals);
    setGovernmentElectricityHours(totalHours);
  };

  // -------- Data loading --------
  // Progressive loading using API queue
  const loadData = useCallback(
    async (opts?: { forDate?: Date }) => {
      const forDate = opts?.forDate ?? selectedDate;

      setApiError(null);
      // Trigger all fetches independently.
      // The Queue in api.ts will handle serialization and priority.

      // 1. Dashboard Data (High Priority)
      setDashboardLoading(true);
      fetchDashboardData()
        .then((data) => {
          setDashboardData(data);
          setDashboardLoading(false);
          // Assuming dashboard is the "main" content for first load
          if (!firstLoadDone) setFirstLoadDone(true);
        })
        .catch((err) => {
          console.error("Dashboard load failed", err);
          setApiError(
            err instanceof Error ? err.message : "Failed to load dashboard",
          );
          setDashboardLoading(false);
        });

      // 2. Grid Stats (Medium Priority)
      setGridLoading(true);
      fetchGridStats({
        period: "overview",
        date_str: forDate.toISOString().split("T")[0],
        currency,
      })
        .then((data) => {
          setGridOverview(data);
          setGridLoading(false);
        })
        .catch((err) => {
          console.error("Grid stats load failed", err);
          setGridLoading(false);
        });

      // 3. Trends (Low Priority)
      setTrendsLoading(true);
      fetchTrendsData(forDate)
        .then((data) => {
          setTrendsData(data);
          if (data?.home?.length) {
            calculateGovernmentElectricityIntervals(data.home);
          } else {
            setGovernmentElectricityIntervals([]);
            setGovernmentElectricityHours(0);
          }
          setTrendsLoading(false);
        })
        .catch((err) => {
          console.error("Trends load failed", err);
          setTrendsLoading(false);
        });
    },
    [selectedDate, firstLoadDone, currency],
  );

  // Initial + on date change
  useEffect(() => {
    loadData({ forDate: selectedDate });
  }, [selectedDate, loadData, currency]);

  // Poll every 30s only when viewing Today (so historical views don't get overwritten)
  useEffect(() => {
    if (!isViewingToday) return;
    const id = setInterval(() => loadData({ forDate: new Date() }), 30000);
    return () => clearInterval(id);
  }, [isViewingToday, loadData]);

  const onRefresh = useCallback(async () => {
    // 1. Trigger immediate pull from backend
    toast.info(t("common.refreshing"));
    try {
      await pullNow();
      toast.success(t("common.refresh_trigger_success"));
    } catch (err) {
      toast.error(t("common.refresh_failed"));
    }

    // 2. Refresh UI data using the selectedDate (not forcing today)
    loadData({ forDate: selectedDate });
  }, [loadData, selectedDate, t]);

  // -------- Derived --------
  const totalLoadW =
    dashboardData &&
    dashboardData.inverters.groundFloor.loadW +
      dashboardData.inverters.firstFloor.loadW;

  // ---- UI helpers: Bottom loading bar (indeterminate) shown only after first load ----
  // Show if ANY is loading (after first load)
  const isAnyLoading = isDashboardLoading || isGridLoading || isTrendsLoading;

  const BottomLoadingBar = () =>
    !firstLoadDone || !isAnyLoading ? null : (
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <div className="h-1 w-full overflow-hidden bg-muted">
          <div className="h-1 w-1/3 animate-pulse bg-primary" />
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        lastUpdated={dashboardData?.lastUpdated || new Date().toISOString()}
        timezone={dashboardData?.location.timezone}
        onRefresh={onRefresh}
      />

      <main className="flex-1">
        <div className="container py-8">
          {apiError && (
            <div className="mb-6">
              <ErrorBanner
                message={apiError}
                onRetry={onRefresh}
                onDismiss={() => setApiError(null)}
              />
            </div>
          )}

          <div className="space-y-6">
            {/* 1. Dashboard Section (High Priority) */}
            {isDashboardLoading && !dashboardData ? (
              <div className="space-y-6">
                {/* Energy Distribution Placeholder */}
                <SkeletonCard />
                {/* Battery Placeholder */}
                <SkeletonBatteryCard />
                {/* Inverters Placeholder */}
                <div className="grid gap-6 md:grid-cols-2">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              </div>
            ) : dashboardData ? (
              <>
                {/* Energy Distribution Card */}
                <EnergyDistributionCard data={dashboardData} />

                {/* Battery Card */}
                <BatteryCard
                  battery={dashboardData.battery}
                  loadW={totalLoadW || 0}
                />

                {/* Inverter Panels */}
                <div className="grid gap-6 md:grid-cols-2">
                  <InverterPanel
                    title={t("trends.ground_floor")}
                    data={dashboardData.inverters.groundFloor}
                  />
                  <InverterPanel
                    title={t("trends.first_floor")}
                    data={dashboardData.inverters.firstFloor}
                  />
                </div>
              </>
            ) : null}

            {/* 2. Grid & Utility Section (Medium Priority) */}
            <div className="grid gap-6 md:grid-cols-2">
              {isGridLoading && !gridOverview ? (
                <SkeletonCard />
              ) : (
                <GovernmentElectricityCard
                  intervals={governmentElectricityIntervals}
                  totalHours={governmentElectricityHours}
                  viewDate={selectedDate}
                  estimatedCost={
                    (gridOverview?.today as any)?.cost_syp_marginal ??
                    (gridOverview?.today as any)?.cost_marginal ??
                    (gridOverview?.today as any)?.cost ??
                    (gridOverview?.today as any)?.bill_syp_standalone ??
                    (gridOverview?.today as any)?.bill_standalone
                  }
                  avgDailyHours={gridOverview?.insights?.avg_grid_hours}
                />
              )}
              {/* Note: PV Stats/Environment currently rely on dashboardData */}
            </div>

            {/* 3. Environment (Relies on DashboardData) */}
            {isDashboardLoading && !dashboardData ? (
              <div className="grid gap-6 md:grid-cols-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : dashboardData ? (
              <div className="grid gap-6 md:grid-cols-2">
                <PvStatsCard stats={dashboardData.pvStats} />
                <EnvironmentCard environment={dashboardData.environment} />
              </div>
            ) : null}

            {/* 4. Trends (Low Priority) */}
            {isTrendsLoading && !trendsData ? (
              <SkeletonCard />
            ) : trendsData ? (
              <TrendsCard
                homeSeries={trendsData.home}
                groundFloorSeries={trendsData.groundFloor}
                firstFloorSeries={trendsData.firstFloor}
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
              />
            ) : null}

            {/* Grid Trends Panel - Also uses grid stats but maybe separate fetch? 
                Currently Home doesn't pass props to GridTrendsPanel, it fetches its own data.
                We might want to optimizing that later, but for now GridTrendsPanel fetches its own data independently.
                Given the requirement "queue", GridTrendsPanel's fetch will also be queued (Medium).
            */}
            <GridTrendsPanel
              overviewData={gridOverview}
              selectedDate={selectedDate}
            />
          </div>
        </div>
      </main>

      {dashboardData && (
        <Footer
          location={dashboardData.location}
          currency={dashboardData.currency}
        />
      )}

      {/* Bottom loading bar after first content paint */}
      <BottomLoadingBar />
    </div>
  );
}
