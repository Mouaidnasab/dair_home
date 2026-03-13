import { Sun, Calendar, CalendarDays, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

interface PvStatsCardProps {
  stats: {
    today: number;
    month: number;
    year: number;
    total: number;
  };
}

export default function PvStatsCard({ stats }: PvStatsCardProps) {
  const { t } = useTranslation();

  const formatKWh = (val: number) => {
    return val.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  };

  return (
    <Card className="col-span-full md:col-span-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-yellow-500" />
          {t("pv_stats.title", "PV Statistics")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* Today */}
          <div className="space-y-2 rounded-lg bg-orange-50 p-4 dark:bg-orange-950/10">
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <Sun className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("pv_stats.today", "Today")}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {formatKWh(stats.today)}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("kWh")}
                </span>
              </div>
            </div>
          </div>

          {/* Month */}
          <div className="space-y-2 rounded-lg bg-blue-50 p-4 dark:bg-blue-950/10">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("pv_stats.month", "This Month")}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {formatKWh(stats.month)}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("kWh")}
                </span>
              </div>
            </div>
          </div>

          {/* Year */}
          <div className="space-y-2 rounded-lg bg-purple-50 p-4 dark:bg-purple-950/10">
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
              <CalendarDays className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("pv_stats.year", "This Year")}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {formatKWh(stats.year)}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("kWh")}
                </span>
              </div>
            </div>
          </div>

          {/* Total */}
          <div className="space-y-2 rounded-lg bg-green-50 p-4 dark:bg-green-950/10">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <History className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("pv_stats.total", "Lifetime")}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {formatKWh(stats.total)}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("kWh")}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("pv_stats.accumulated", "Total Generated")}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
