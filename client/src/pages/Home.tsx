import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Header from "@/components/Header";
import BatteryCard from "@/components/BatteryCard";
import InverterPanel from "@/components/InverterPanel";
import TrendsCard from "@/components/TrendsCard";
import ElectricityStatusCard from "@/components/ElectricityStatusCard";

import Footer from "@/components/Footer";
import ErrorBanner from "@/components/ErrorBanner";
import GovernmentElectricityCard from "@/components/GovernmentElectricityCard";
import { SkeletonBatteryCard, SkeletonCard } from "@/components/SkeletonCard";
import { fetchDashboardData, fetchTrendsData } from "@/lib/api";

import { DashboardData, TrendsSeries, TimeSeriesPoint } from "@/types/energy";

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

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null
  );
  const [trendsData, setTrendsData] = useState<TrendsSeries | null>(null);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [firstLoadDone, setFirstLoadDone] = useState(false); // show skeletons only before this turns true
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
    [selectedDate]
  );

  // -------- Helpers --------
  const calculateGovernmentElectricityIntervals = (
    timeSeriesData: TimeSeriesPoint[]
  ) => {
    // Grid power > 0 => drawing from government electricity
    const intervals: ElectricityInterval[] = [];
    let current: ElectricityInterval | null = null;
    let totalHours = 0;

    for (let i = 0; i < timeSeriesData.length; i++) {
      const point = timeSeriesData[i];
      const gridPower = point.gridPower || 0;
      const drawingFromGrid = gridPower > 0;

      if (drawingFromGrid) {
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
          (end.getTime() - start.getTime()) / (1000 * 60)
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
  const loadData = useCallback(
    async (opts?: { forDate?: Date }) => {
      const forDate = opts?.forDate ?? selectedDate;
      try {
        setApiError(null);

        // If this is after first load, we want bottom loading bar instead of skeletons
        setIsLoading(true);

        const [dashboard, trends] = await Promise.all([
          // Dashboard = current snapshot
          fetchDashboardData(),
          // Trends = selected day
          fetchTrendsData(forDate),
        ]);

        setDashboardData(dashboard);
        setTrendsData(trends);

        if (trends?.home?.length) {
          calculateGovernmentElectricityIntervals(trends.home);
        } else {
          setGovernmentElectricityIntervals([]);
          setGovernmentElectricityHours(0);
        }
      } catch (err) {
        console.error("Failed to load data:", err);
        setApiError(
          err instanceof Error ? err.message : t("error.failed_fetch")
        );
      } finally {
        setIsLoading(false);
        if (!firstLoadDone) setFirstLoadDone(true);
      }
    },
    [selectedDate, t, firstLoadDone]
  );

  // Initial + on date change
  useEffect(() => {
    loadData({ forDate: selectedDate });
  }, [selectedDate, loadData]);

  // Poll every 30s only when viewing Today (so historical views don't get overwritten)
  useEffect(() => {
    if (!isViewingToday) return;
    const id = setInterval(() => loadData({ forDate: new Date() }), 30000);
    return () => clearInterval(id);
  }, [isViewingToday, loadData]);

  const onRefresh = useCallback(() => {
    // Refresh using the selectedDate (not forcing today)
    loadData({ forDate: selectedDate });
  }, [loadData, selectedDate]);

  // -------- Derived --------
  const totalLoadW =
    dashboardData &&
    dashboardData.inverters.groundFloor.loadW +
      dashboardData.inverters.firstFloor.loadW;

  // ---- UI helpers: Bottom loading bar (indeterminate) shown only after first load ----
  const BottomLoadingBar = () =>
    !firstLoadDone || !isLoading ? null : (
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

          {/* Before first load finishes: show skeletons */}
          {!firstLoadDone && isLoading ? (
            <div className="space-y-6">
              <SkeletonCard />
              <SkeletonBatteryCard />
              <div className="grid gap-6 md:grid-cols-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
              <SkeletonCard />
            </div>
          ) : dashboardData && trendsData ? (
            <div className="space-y-6">
              {/* Electricity Status Card */}
              <ElectricityStatusCard data={dashboardData} />

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

              {/* Government Electricity — pass the viewed date */}
              <div className="grid gap-6 md:grid-cols-2">
                <GovernmentElectricityCard
                  intervals={governmentElectricityIntervals}
                  totalHours={governmentElectricityHours}
                  viewDate={selectedDate} // <- pass selected date so the card can show the current viewing date
                />
              </div>

              {/* Trends (controlled date) */}
              <TrendsCard
                homeSeries={trendsData.home}
                groundFloorSeries={trendsData.groundFloor}
                firstFloorSeries={trendsData.firstFloor}
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
              />
            </div>
          ) : (
            // After first load: if something fails and we have no data, show a compact error area
            <div className="flex h-96 items-center justify-center text-muted-foreground">
              {t("error.failed_fetch")}
            </div>
          )}
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
