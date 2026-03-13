import { useState } from "react";
import { Battery, Zap, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatPower,
  formatRuntime,
  calculateEstimatedRuntime,
  getBatteryStateColor,
  getBatteryStateLabel,
} from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { BatteryData, BatteryDetail } from "@/types/energy";
import { fetchBatteryDetails } from "@/lib/api";

interface BatteryCardProps {
  battery: BatteryData;
  loadW: number;
  batteryCapacityWh?: number;
}

export default function BatteryCard({
  battery,
  loadW,
  batteryCapacityWh = 15000,
}: BatteryCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [details, setDetails] = useState<BatteryDetail | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const runtime = calculateEstimatedRuntime(
    battery.soc,
    battery.powerW,
    batteryCapacityWh,
  ); // loadW now represents total load from both inverters
  const stateColor = getBatteryStateColor(battery.state);
  const stateLabel = getBatteryStateLabel(battery.state);

  // Calculate radial gauge rotation (0% = 0deg, 100% = 360deg)
  const rotation = (battery.soc / 100) * 360;

  const toggleExpand = async () => {
    if (!isExpanded) {
      setIsExpanded(true);
      if (!details) {
        setIsLoadingDetails(true);
        try {
          const data = await fetchBatteryDetails({ limit: 1 });
          if (data && data.length > 0) {
            setDetails(data[0]);
          }
        } catch (err) {
          console.error("Failed to load battery details", err);
        } finally {
          setIsLoadingDetails(false);
        }
      }
    } else {
      setIsExpanded(false);
    }
  };

  return (
    <Card className="col-span-full" data-testid="battery-card">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Battery className="h-5 w-5" />
            {t("battery.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {t(`battery.${stateLabel.toLowerCase()}`)}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleExpand}
              className="h-8 w-8 p-0 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:text-primary transition-all shadow-sm"
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:items-center">
          {/* Radial Gauge */}
          <div className="flex justify-center md:col-span-1">
            <div className="relative h-40 w-40">
              {/* Background circle */}
              <svg
                className="absolute inset-0 h-full w-full -rotate-90"
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-muted-foreground/20"
                />
                {/* Progress circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${(battery.soc / 100) * 282.7} 282.7`}
                  className={
                    battery.soc > 50
                      ? "text-green-500"
                      : battery.soc > 20
                        ? "text-yellow-500"
                        : "text-red-500"
                  }
                  strokeLinecap="round"
                />
              </svg>

              {/* Center content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-4xl font-bold">{battery.soc}%</div>
                <div className="text-xs text-muted-foreground">
                  {t("battery.soc")}
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-4 md:col-span-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1 cursor-help">
                  <div className="text-sm text-muted-foreground">
                    {t("battery.power")}
                  </div>
                  <div className={`text-2xl font-semibold ${stateColor}`}>
                    {battery.powerW > 0 ? "+" : ""}
                    {formatPower(battery.powerW)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {battery.powerW > 10
                      ? t("battery.charging")
                      : battery.powerW < -10
                        ? t("battery.discharging")
                        : t("battery.idle")}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1 text-sm">
                  <p>{t("battery.info_positive")}</p>
                  <p>{t("battery.info_negative")}</p>
                  <p>
                    {t("battery.info_capacity")}: {batteryCapacityWh / 1000} kWh
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1 cursor-help">
                  <div className="text-sm text-muted-foreground">
                    {t("battery.runtime")}
                  </div>
                  <div className="flex items-center gap-2 text-2xl font-semibold">
                    <Zap className="h-5 w-5" />
                    {formatRuntime(runtime)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("battery.at_load")} {Math.round(battery.powerW) * -1} W
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1 text-sm">
                  <p>{t("battery.info_runtime")}</p>
                  <p>{t("battery.info_assumptions")}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Detailed View */}
        {isExpanded && (
          <div className="mt-6 border-t pt-4 animate-in fade-in slide-in-from-top-2">
            {isLoadingDetails ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : details ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-sm text-muted-foreground">
                      {t("battery.voltage")}
                    </div>
                    <div className="text-lg font-semibold">
                      {details.battVolt} V
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-sm text-muted-foreground">
                      {t("battery.current")}
                    </div>
                    <div className="text-lg font-semibold">
                      {details.battCurr} A
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-sm text-muted-foreground">
                      {t("battery.temp")}
                    </div>
                    <div className="text-lg font-semibold">
                      {details.battTemp}°C
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-sm text-muted-foreground">
                      {t("battery.soh")}
                    </div>
                    <div className="text-lg font-semibold">{details.soh}%</div>
                  </div>
                </div>

                {/* Individual Cell Voltages */}
                <div>
                  <h4 className="mb-3 text-sm font-medium text-muted-foreground">
                    {t("battery.cell_voltages")}
                  </h4>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                    {details.cellVoltList.map((volt, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col items-center rounded bg-muted/30 p-2 text-center"
                      >
                        <span className="text-xs text-muted-foreground">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-sm font-medium">
                          {volt}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Individual Cell Temps */}
                {details.cellTempList && details.cellTempList.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-muted-foreground">
                      {t("battery.cell_temperatures")}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {details.cellTempList.slice(0, 4).map((temp, idx) => (
                        <Badge key={idx} variant="secondary">
                          T{idx + 1}: {temp}°C
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-4">
                {t("battery.no_details")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
