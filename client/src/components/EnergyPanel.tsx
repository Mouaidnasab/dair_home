import { BatteryCharging, Home as HomeIcon, PlugZap, Sun } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import DayNav from "@/components/DayNav";
import Stat from "@/components/Stat";
import ZoneTabs from "@/components/ZoneTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { cn, formatEnergy, formatMoney, localDay, shiftDay, shiftMonth } from "@/lib/utils";
import type { Period, ZoneOrHome } from "@/types/energy";

const PERIODS: Period[] = ["day", "month", "cycle", "year"];

function step(period: Period, date: string, dir: 1 | -1): string {
  if (period === "day") return shiftDay(date, dir);
  if (period === "month") return shiftMonth(date, dir);
  if (period === "cycle") return shiftMonth(date, 2 * dir);
  return shiftMonth(date, 12 * dir);
}

function EnergyPanel() {
  const { t } = useTranslation();
  const { currency } = useCurrency();
  const today = localDay();
  const [period, setPeriod] = useState<Period>("cycle");
  const [date, setDate] = useState(today);
  const [zone, setZone] = useState<ZoneOrHome>("home");
  const energy = usePolling(signal => api.energy(period, date, zone, currency, signal), 0, [period, date, zone, currency]);
  const cycles = usePolling(signal => api.cycles(zone, currency, signal), 0, [zone, currency]);

  const e = energy.data;
  const bars = useMemo(() => (e?.breakdown ?? []).map(b => ({ ...b, label: period === "month" || period === "cycle" ? b.key.slice(8) : b.key.slice(period === "year" ? 5 : 0) })), [e, period]);
  const label = period === "day" ? date : period === "year" ? date.slice(0, 4) : period === "month" ? date.slice(0, 7) : e?.bill.cycle.label ?? "…";
  const nextDisabled = step(period, date, 1) > today && (period === "day" || e?.end_day === undefined || e.end_day >= today);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{t("energy.title")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <ZoneTabs value={zone} onChange={setZone} />
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={cn("rounded-md px-2.5 py-1 font-medium", period === p ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {t(`energy.${p}`)}
              </button>
            ))}
          </div>
          <DayNav label={label} onPrev={() => setDate(d => step(period, d, -1))} onNext={() => setDate(d => step(period, d, 1))} nextDisabled={nextDisabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {energy.error && <p className="text-sm text-destructive">{energy.error}</p>}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat icon={Sun} tone="text-yellow-500" label={t("power.solar")} value={formatEnergy(e?.totals.pv_kwh)} />
          <Stat icon={HomeIcon} tone="text-cyan-500" label={t("power.load")} value={formatEnergy(e?.totals.load_kwh)} />
          <Stat
            icon={BatteryCharging}
            tone="text-pink-500"
            label={t("energy.battery_in_out")}
            value={e ? `${e.totals.bat_charge_kwh.toFixed(1)} / ${e.totals.bat_discharge_kwh.toFixed(1)}` : "—"}
            hint="kWh"
          />
          <Stat
            icon={PlugZap}
            tone="text-blue-500"
            label={t("energy.grid_import")}
            value={formatEnergy(e?.totals.grid_kwh)}
            hint={e ? `${formatMoney(e.bill.amount, currency)} · ${t("energy.grid_hours", { hours: e.totals.grid_up_hours.toFixed(1) })}` : undefined}
          />
        </div>

        {bars.length > 0 && (
          <div className="h-56" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={40} unit="" />
                <Tooltip formatter={(v: number, name: string) => [formatEnergy(v), t(name === "pv_kwh" ? "power.solar" : name === "load_kwh" ? "power.load" : "energy.grid_import")]} />
                <Bar dataKey="pv_kwh" fill="#eab308" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="load_kwh" fill="#06b6d4" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="grid_kwh" fill="#3b82f6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {e && (
          <div className="rounded-xl border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">
                {t("energy.bill")} · {e.bill.cycle.label}
              </span>
              <span className="font-bold tabular-nums">{formatMoney(e.bill.cycle.amount, currency)}</span>
            </div>
            <div className="space-y-1.5">
              {e.bill.cycle.tiers.map((tier, i) => {
                const cap = tier.limit_kwh === null ? null : tier.limit_kwh - (i ? e.bill.cycle.tiers[i - 1].limit_kwh ?? 0 : 0);
                const pct = cap ? Math.min(100, (tier.filled_kwh / cap) * 100) : tier.filled_kwh > 0 ? 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 text-muted-foreground">
                      {tier.limit_kwh === null ? t("energy.tier_rest") : t("energy.tier_upto", { kwh: tier.limit_kwh })}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full", i ? "bg-red-500" : "bg-blue-500")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-36 text-end tabular-nums">
                      {tier.filled_kwh.toFixed(1)} kWh × {formatMoney(tier.price, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cycles.data && cycles.data.cycles.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 text-start font-medium">{t("energy.cycle")}</th>
                  <th className="py-1 text-end font-medium">{t("energy.grid_import")}</th>
                  <th className="py-1 text-end font-medium">{t("energy.bill")}</th>
                </tr>
              </thead>
              <tbody>
                {cycles.data.cycles.map(c => (
                  <tr key={c.start_day} className="border-t">
                    <td className="py-1">{c.label}</td>
                    <td className="py-1 text-end tabular-nums">{formatEnergy(c.grid_kwh)}</td>
                    <td className="py-1 text-end tabular-nums">{formatMoney(c.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(EnergyPanel);
