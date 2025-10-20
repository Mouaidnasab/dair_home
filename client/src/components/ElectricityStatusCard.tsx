import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Zap, Battery, Home } from "lucide-react";
import { formatPower } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { DashboardData } from "@/types/energy";

interface ElectricityStatusCardProps {
  data: DashboardData;
}

export default function ElectricityStatusCard({ data }: ElectricityStatusCardProps) {
  const { t, i18n } = useTranslation();

  // Calculate total PV power from both inverters
  const totalPvPower = data.inverters.groundFloor.pvNowW + data.inverters.firstFloor.pvNowW;
  
  // Calculate total home load from both inverters
  const totalHomeLoad = data.inverters.groundFloor.loadW + data.inverters.firstFloor.loadW;
  
  // Grid power (positive = importing, negative = exporting)
  const gridPower = data.inverters.groundFloor.gridW + data.inverters.firstFloor.gridW;
  
  // Battery power (positive = charging, negative = discharging)
  const batteryPower = data.battery.powerW;

  // Determine if electricity is coming from grid (positive grid power)
  const isGridIncoming = gridPower > 0;

  // Calculate consumption breakdown by priority: Solar -> Battery -> Grid
  let solarConsumption = Math.min(totalPvPower, totalHomeLoad);
  let remainingLoad = totalHomeLoad - solarConsumption;
  
  let batteryConsumption = 0;
  let gridConsumption = 0;
  
  if (remainingLoad > 0) {
    // If battery is discharging, use it for consumption
    if (batteryPower < 0) {
      batteryConsumption = Math.min(Math.abs(batteryPower), remainingLoad);
      remainingLoad -= batteryConsumption;
    }
    // Remaining load comes from grid
    gridConsumption = remainingLoad;
  }

  // Determine electricity status
  

  return (
    <Card className="col-span-full relative" data-testid="electricity-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div
            className={`h-3 w-3 rounded-full ${data.grid.isPowerOn ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}
          />
          <span className="text-lg font-bold">
            {data.grid.isPowerOn ? t("electricity_status_on") : t("electricity_status_off")}
          </span>
          <div className="absolute top-4 right-4 flex items-center space-x-2">
            <button
              onClick={() => i18n.changeLanguage("en")}
              className={`px-3 py-1 rounded-md text-sm ${i18n.language === "en" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700"}`}
            >
              EN
            </button>
            <button
              onClick={() => i18n.changeLanguage("ar")}
              className={`px-3 py-1 rounded-md text-sm ${i18n.language === "ar" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700"}`}
            >
              AR
            </button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Home Consumption Breakdown */}
        <div className="space-y-4">
          <div className="text-sm font-semibold text-muted-foreground">
            {t("home_consumption_breakdown", { totalLoad: formatPower(totalHomeLoad) })}
          </div>

          {/* Solar Consumption */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="h-5 w-5 text-yellow-500" />
                <span className="text-sm font-medium">{t("from_solar")}</span>
              </div>
              <span className="text-lg font-bold text-yellow-500">
                {formatPower(solarConsumption)}
              </span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-yellow-500"
                style={{
                  width: `${totalHomeLoad > 0 ? (solarConsumption / totalHomeLoad) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Battery Consumption */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Battery className="h-5 w-5 text-pink-500" />
                <span className="text-sm font-medium">{t("from_battery")}</span>
              </div>
              <span className="text-lg font-bold text-pink-500">
                {formatPower(batteryConsumption)}
              </span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-pink-500"
                style={{
                  width: `${totalHomeLoad > 0 ? (batteryConsumption / totalHomeLoad) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Grid Consumption */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-500" />
                <span className="text-sm font-medium">{t("from_grid")}</span>
              </div>
              <span className="text-lg font-bold text-blue-500">
                {formatPower(gridConsumption)}
              </span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500"
                style={{
                  width: `${totalHomeLoad > 0 ? (gridConsumption / totalHomeLoad) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="border-t border-border pt-4 grid grid-cols-3 gap-4">
          <div className="text-center space-y-1">
            <div className="text-xs text-muted-foreground">{t("solar_percent")}</div>
            <div className="text-lg font-bold text-yellow-500">
              {totalHomeLoad > 0 ? Math.round((solarConsumption / totalHomeLoad) * 100) : 0}%
            </div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-xs text-muted-foreground">{t("battery_percent")}</div>
            <div className="text-lg font-bold text-pink-500">
              {totalHomeLoad > 0 ? Math.round((batteryConsumption / totalHomeLoad) * 100) : 0}%
            </div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-xs text-muted-foreground">{t("grid_percent")}</div>
            <div className="text-lg font-bold text-blue-500">
              {totalHomeLoad > 0 ? Math.round((gridConsumption / totalHomeLoad) * 100) : 0}%
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="border-t border-border pt-4 space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>{t("total_home_load")}:</span>
            <span className="font-semibold text-foreground">{formatPower(totalHomeLoad)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("solar_generation")}:</span>
            <span className="font-semibold text-foreground">{formatPower(totalPvPower)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("battery_status")}:</span>
            <span className="font-semibold text-foreground">
              {batteryPower > 0 ? t("charging") : batteryPower < 0 ? t("discharging") : t("idle")} ({formatPower(Math.abs(batteryPower))})
            </span>
          </div>
          <div className="flex justify-between">
            <span>{t("grid_status")}:</span>
            <span className="font-semibold text-foreground">
              {isGridIncoming ? t("importing") : t("exporting")} ({formatPower(Math.abs(gridPower))})
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

