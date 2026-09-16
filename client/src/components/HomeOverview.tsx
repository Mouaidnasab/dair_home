import { BatteryCharging, Home as HomeIcon, PlugZap, Sun, Zap, ZapOff } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import Stat from "@/components/Stat";
import { Card, CardContent } from "@/components/ui/card";
import { formatPower } from "@/lib/utils";
import type { PowerSummary } from "@/types/energy";

function batteryHint(t: (k: string) => string, bat_w: number | null) {
  if (bat_w === null) return undefined;
  if (bat_w > 20) return t("battery.charging");
  if (bat_w < -20) return t("battery.discharging");
  return t("battery.idle");
}

function HomeOverview({ home }: { home: PowerSummary }) {
  const { t } = useTranslation();
  const gridOn = home.grid_available;
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <Stat icon={Sun} tone="text-yellow-500" label={t("power.solar")} value={formatPower(home.pv_w)} />
        <Stat icon={HomeIcon} tone="text-cyan-500" label={t("power.load")} value={formatPower(home.load_w)} />
        <Stat
          icon={BatteryCharging}
          tone="text-pink-500"
          label={t("power.battery")}
          value={home.soc === null ? formatPower(home.bat_w) : `${Math.round(home.soc)}%`}
          hint={home.soc === null ? batteryHint(t, home.bat_w) : `${batteryHint(t, home.bat_w) ?? ""} · ${formatPower(home.bat_w)}`}
        />
        <Stat
          icon={gridOn ? (home.grid_w && home.grid_w > 10 ? PlugZap : Zap) : ZapOff}
          tone={gridOn ? "text-blue-500" : "text-muted-foreground"}
          label={t("power.grid")}
          value={gridOn === null ? "—" : gridOn ? t("grid.on") : t("grid.off")}
          hint={gridOn ? `${formatPower(home.grid_w)} · ${Math.round(home.grid_v ?? 0)} V` : undefined}
        />
      </CardContent>
    </Card>
  );
}

export default memo(HomeOverview);
