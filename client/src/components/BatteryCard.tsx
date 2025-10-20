import { Battery, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useLanguage } from "@/contexts/LanguageContext";
import { BatteryData } from "@/types/energy";

interface BatteryCardProps {
  battery: BatteryData;
  loadW: number;
  batteryCapacityWh?: number;
}

export default function BatteryCard({
  battery,
  loadW,
  batteryCapacityWh = 10000,
}: BatteryCardProps) {
  const { t } = useLanguage();
  const runtime = calculateEstimatedRuntime(battery.soc, loadW, batteryCapacityWh);
  const stateColor = getBatteryStateColor(battery.state);
  const stateLabel = getBatteryStateLabel(battery.state);

  // Calculate radial gauge rotation (0% = 0deg, 100% = 360deg)
  const rotation = (battery.soc / 100) * 360;

  return (
    <Card className="col-span-full" data-testid="battery-card">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Battery className="h-5 w-5" />
            {t("battery.title")}
          </CardTitle>
          <Badge variant="outline">{t(`battery.${stateLabel.toLowerCase()}`)}</Badge>
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
                <div className="text-xs text-muted-foreground">{t("battery.soc")}</div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-4 md:col-span-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1 cursor-help">
                  <div className="text-sm text-muted-foreground">{t("battery.power")}</div>
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
                  <p>{t("battery.info_capacity")}: {batteryCapacityWh / 1000} kWh {t("battery.info_mock")}</p>
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1 cursor-help">
                  <div className="text-sm text-muted-foreground">{t("battery.runtime")}</div>
                  <div className="flex items-center gap-2 text-2xl font-semibold">
                    <Zap className="h-5 w-5" />
                    {formatRuntime(runtime)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("battery.at_load")} {Math.round(loadW)} W
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
      </CardContent>
    </Card>
  );
}

