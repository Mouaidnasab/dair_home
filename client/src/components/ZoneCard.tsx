import { AlertTriangle, BatteryCharging, Home as HomeIcon, Sun, Thermometer, Zap, ZapOff } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import Stat from "@/components/Stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatAge, formatEnergy, formatPower, socColor } from "@/lib/utils";
import type { DeviceLive, ZoneLive } from "@/types/energy";

interface ZoneCardProps {
  zone: ZoneLive;
  batteries: DeviceLive[];
}

function ZoneCard({ zone, batteries }: ZoneCardProps) {
  const { t } = useTranslation();
  const inv = zone.inverters[0];
  const stale = zone.inverters.some(i => i.stale);
  const pvToday = zone.inverters.reduce((s, i) => s + (i.e_pv_today ?? 0), 0);
  return (
    <Card className={cn(stale && "opacity-80")}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">{t(`zone.${zone.zone}`)}</CardTitle>
        <div className="flex items-center gap-1.5">
          {zone.grid_available === null ? null : zone.grid_available ? (
            <Badge variant="outline" className="gap-1 text-blue-600">
              <Zap className="h-3 w-3" /> {t("grid.on")}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <ZapOff className="h-3 w-3" /> {t("grid.off")}
            </Badge>
          )}
          {stale && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {formatAge(inv?.age_s ?? null)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={Sun} tone="text-yellow-500" label={t("power.solar")} value={formatPower(zone.pv_w)} hint={`${t("common.today")} ${formatEnergy(pvToday)}`} />
          <Stat icon={HomeIcon} tone="text-cyan-500" label={t("power.load")} value={formatPower(zone.load_w)} />
          <Stat
            icon={BatteryCharging}
            tone="text-pink-500"
            label={t("power.battery_flow")}
            value={formatPower(zone.bat_w)}
            hint={zone.bat_w === null ? undefined : zone.bat_w >= 0 ? t("battery.charging") : t("battery.discharging")}
          />
          <Stat icon={Thermometer} tone="text-orange-500" label={t("inverter.temp")} value={inv?.inv_temp_c == null ? "—" : `${inv.inv_temp_c} °C`} hint={inv?.extra.work_mode ?? undefined} />
        </div>
        {batteries.map(b => (
          <div key={b.sn} className="flex items-center gap-3 text-xs">
            <span className="w-28 shrink-0 truncate text-muted-foreground">
              {b.zones.length > 1 ? t("battery.shared") : t("battery.title")} · {b.model}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", socColor(b.soc))} style={{ width: `${b.soc ?? 0}%` }} />
            </div>
            <span className="w-10 text-end font-semibold tabular-nums">{b.soc == null ? "—" : `${Math.round(b.soc)}%`}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default memo(ZoneCard);
