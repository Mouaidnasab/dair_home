import { useState, useEffect } from "react";
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

import { DashboardData, TrendsSeries } from "@/types/energy";

interface ElectricityInterval {
  startTime: string;
  endTime: string;
  duration: number;
}

export default function Home() {
  const { t } = useTranslation();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [trendsData, setTrendsData] = useState<TrendsSeries | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [governmentElectricityIntervals, setGovernmentElectricityIntervals] = useState<ElectricityInterval[]>([]);
  const [governmentElectricityHours, setGovernmentElectricityHours] = useState(0);

  const loadData = async () => {
    try {
      setApiError(null);
      const [dashboard, trends] = await Promise.all([
        fetchDashboardData(),
        fetchTrendsData(),
      ]);
      setDashboardData(dashboard);
      setTrendsData(trends);

      // Calculate government electricity intervals from trends data
      if (trends && trends.home && trends.home.length > 0) {
        calculateGovernmentElectricityIntervals(trends.home);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
      setApiError(
        err instanceof Error
          ? err.message
          : t("error.failed_fetch")
      );
    } finally {
      setIsLoading(false);
    }
  };

  const calculateGovernmentElectricityIntervals = (timeSeriesData: any[]) => {
    // Government electricity is when grid power (ef_acTtlInPower) is positive
    // meaning we're drawing from the grid
    const intervals: ElectricityInterval[] = [];
    let currentInterval: ElectricityInterval | null = null;
    let totalHours = 0;

    for (let i = 0; i < timeSeriesData.length; i++) {
      const point = timeSeriesData[i];
      const gridPower = point.gridPower || 0;
      const isDrawingFromGrid = gridPower > 0;

      if (isDrawingFromGrid) {
        if (!currentInterval) {
          // Start a new interval
          currentInterval = {
            startTime: point.timestamp,
            endTime: point.timestamp,
            duration: 0,
          };
        } else {
          // Continue the interval
          currentInterval.endTime = point.timestamp;
        }
      } else {
        if (currentInterval) {
          // End the current interval
          const start = new Date(currentInterval.startTime);
          const end = new Date(currentInterval.endTime);
          const durationMs = end.getTime() - start.getTime();
          const durationMins = Math.round(durationMs / (1000 * 60));
          
          if (durationMins > 0) {
            currentInterval.duration = durationMins;
            intervals.push(currentInterval);
            totalHours += durationMins / 60;
          }
          currentInterval = null;
        }
      }
    }

    // Handle case where interval extends to end of data
    if (currentInterval) {
      const start = new Date(currentInterval.startTime);
      const end = new Date(currentInterval.endTime);
      const durationMs = end.getTime() - start.getTime();
      const durationMins = Math.round(durationMs / (1000 * 60));
      
      if (durationMins > 0) {
        currentInterval.duration = durationMins;
        intervals.push(currentInterval);
        totalHours += durationMins / 60;
      }
    }

    setGovernmentElectricityIntervals(intervals);
    setGovernmentElectricityHours(totalHours);
  };

  useEffect(() => {
    loadData();

    // Set up polling every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalLoadW =
    dashboardData &&
    (dashboardData.inverters.groundFloor.loadW +
      dashboardData.inverters.firstFloor.loadW);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        lastUpdated={dashboardData?.lastUpdated || new Date().toISOString()}
        timezone={dashboardData?.location.timezone}
        onRefresh={loadData}
      />

      <main className="flex-1">
        <div className="container py-8">
          {apiError && (
            <div className="mb-6">
              <ErrorBanner
                message={apiError}
                onRetry={loadData}
                onDismiss={() => setApiError(null)}
              />
            </div>
          )}

          {isLoading ? (
            <div className="space-y-6">
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

              {/* Government Electricity and PV Total */}
              <div className="grid gap-6 md:grid-cols-2">
                <GovernmentElectricityCard
                  intervals={governmentElectricityIntervals}
                  totalHours={governmentElectricityHours}
                />
              </div>

              {/* Trends Card */}
              <TrendsCard
                homeSeries={trendsData.home}
                groundFloorSeries={trendsData.groundFloor}
                firstFloorSeries={trendsData.firstFloor}
              />
            </div>
          ) : (
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
    </div>
  );
}

