import { ChevronDown } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatPower, socColor } from "@/lib/utils";
import type { DeviceLive } from "@/types/energy";

function BatteryCard({ battery }: { battery: DeviceLive }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const soc = battery.soc;
  const cells = battery.extra.cells_v ?? [];
  const spread = battery.cell_v_max != null && battery.cell_v_min != null ? (battery.cell_v_max - battery.cell_v_min) * 1000 : null;
  const state = battery.bat_w == null ? "" : battery.bat_w > 20 ? t("battery.charging") : battery.bat_w < -20 ? t("battery.discharging") : t("battery.idle");

  const rows: [string, string][] = [
    [t("battery.voltage"), battery.bat_v == null ? "—" : `${battery.bat_v.toFixed(2)} V`],
    [t("battery.current"), battery.bat_a == null ? "—" : `${battery.bat_a.toFixed(1)} A`],
    [t("battery.health"), battery.soh == null ? "—" : `${battery.soh}%`],
    [t("battery.temp"), battery.temp_c == null ? "—" : `${battery.temp_c} °C`],
    [t("battery.cells"), battery.cell_v_min == null ? "—" : `${battery.cell_v_min.toFixed(3)}–${battery.cell_v_max?.toFixed(3)} V`],
    [t("battery.spread"), spread == null ? "—" : `${Math.round(spread)} mV`],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">{battery.alias || t("battery.title")}</CardTitle>
          <div className="text-xs text-muted-foreground">
            {battery.model} · {battery.sn}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {battery.zones.map(z => (
            <Badge key={z} variant="secondary">
              {t(`zone.${z}`)}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between">
          <div className="text-3xl font-bold tabular-nums">{soc == null ? "—" : `${Math.round(soc)}%`}</div>
          <div className="text-end text-sm">
            <div className="font-semibold tabular-nums">{formatPower(battery.bat_w)}</div>
            <div className="text-xs text-muted-foreground">{state}</div>
          </div>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", socColor(soc))} style={{ width: `${soc ?? 0}%` }} />
        </div>
        {battery.zones.length > 1 && <p className="text-xs text-muted-foreground">{t("battery.shared_hint")}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {cells.length > 0 && (
          <div>
            <button className="flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setOpen(o => !o)}>
              <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
              {t("battery.cell_detail", { count: cells.length })}
            </button>
            {open && (
              <div className="mt-2 grid grid-cols-4 gap-1 sm:grid-cols-8">
                {cells.map((v, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded bg-muted px-1 py-0.5 text-center text-[10px] tabular-nums",
                      v === battery.cell_v_max && "text-emerald-600",
                      v === battery.cell_v_min && "text-red-500",
                    )}
                  >
                    {v.toFixed(3)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(BatteryCard);
