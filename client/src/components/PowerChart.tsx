import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import DayNav from "@/components/DayNav";
import ZoneTabs from "@/components/ZoneTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { formatClock, formatPower, localDay, shiftDay } from "@/lib/utils";
import type { ZoneOrHome } from "@/types/energy";

const SERIES = [
  { key: "pv_w", color: "#eab308", label: "power.solar" },
  { key: "load_w", color: "#06b6d4", label: "power.load" },
  { key: "bat_w", color: "#ec4899", label: "power.battery_flow" },
  { key: "grid_w", color: "#3b82f6", label: "power.grid" },
] as const;

function PowerChart() {
  const { t, i18n } = useTranslation();
  const today = localDay();
  const [day, setDay] = useState(today);
  const [zone, setZone] = useState<ZoneOrHome>("home");
  const isToday = day === today;
  const { data, error } = usePolling(signal => api.series(day, zone, signal), isToday ? 300_000 : 0, [day, zone, isToday]);

  const points = data?.points ?? [];
  const hasGrid = useMemo(() => points.some(p => (p.grid_w ?? 0) > 0), [points]);
  const tickTime = useCallback((ts: number) => formatClock(ts, i18n.language), [i18n.language]);
  const tooltipValue = useCallback((v: number, name: string) => [name === "soc" ? `${Math.round(v)}%` : formatPower(v), t(SERIES.find(s => s.key === name)?.label ?? "battery.soc")], [t]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{t("chart.title")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <ZoneTabs value={zone} onChange={setZone} />
          <DayNav label={day} onPrev={() => setDay(d => shiftDay(d, -1))} onNext={() => setDay(d => shiftDay(d, 1))} nextDisabled={isToday} />
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && points.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{data ? t("chart.no_data") : t("common.loading")}</p>
        ) : (
          <div className="h-72" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickTime} tick={{ fontSize: 11 }} minTickGap={40} />
                <YAxis yAxisId="w" tickFormatter={v => formatPower(v)} tick={{ fontSize: 11 }} width={56} />
                <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} width={32} unit="%" />
                <Tooltip labelFormatter={v => tickTime(Number(v))} formatter={tooltipValue as never} />
                <Area yAxisId="w" dataKey="pv_w" stroke="#eab308" fill="#eab308" fillOpacity={0.15} dot={false} isAnimationActive={false} connectNulls />
                {SERIES.slice(1).map(s =>
                  s.key === "grid_w" && !hasGrid ? null : (
                    <Line key={s.key} yAxisId="w" dataKey={s.key} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  ),
                )}
                <Line yAxisId="soc" dataKey="soc" stroke="#10b981" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {SERIES.map(s => (s.key === "grid_w" && !hasGrid ? null : (
            <span key={s.key} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> {t(s.label)}
            </span>
          )))}
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t("battery.soc")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(PowerChart);
