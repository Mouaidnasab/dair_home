import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchGridStats, fetchCyclesSummary } from "@/lib/api";
import { GridStats, CycleSummaryItem } from "@/types/energy";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Zap,
  ZapOff,
  History,
  LayoutGrid,
} from "lucide-react";
import { cn, getCostColor } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/contexts/CurrencyContext";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GridTrendsPanelProps {
  overviewData?: GridStats | null;
  selectedDate?: Date;
}

export default function GridTrendsPanel({
  overviewData,
  selectedDate: propDate,
}: GridTrendsPanelProps) {
  const { t, i18n } = useTranslation();
  const { currency } = useCurrency();
  const [activeTab, setActiveTab] = useState("cycle");
  const [breakdownData, setBreakdownData] = useState<GridStats | null>(null);
  const [cyclesData, setCyclesData] = useState<CycleSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [cycleLimit, setCycleLimit] = useState(5);

  // Local date state to allow navigating independently
  const [viewDate, setViewDate] = useState<Date>(propDate || new Date());

  // Sync if propDate changes from outside
  useEffect(() => {
    if (propDate) setViewDate(propDate);
  }, [propDate]);

  const dateStr = viewDate.toISOString().split("T")[0];

  const navigateDate = (amount: number) => {
    const next = new Date(viewDate);
    if (activeTab === "day") {
      next.setDate(next.getDate() + amount);
    } else if (activeTab === "month" || activeTab === "cycle") {
      next.setMonth(next.getMonth() + amount);
    } else if (activeTab === "year") {
      next.setFullYear(next.getFullYear() + amount);
    }

    if (next > new Date()) return;
    setViewDate(next);
  };

  const formattedViewDate = useMemo(() => {
    if (activeTab === "year") return viewDate.getFullYear().toString();
    if (activeTab === "month")
      return viewDate.toLocaleString(i18n.language, {
        month: "long",
        year: "numeric",
      });
    if (activeTab === "cycle") {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const startMonthIndex = Math.floor(month / 2) * 2;
      const d1 = new Date(year, startMonthIndex, 1);
      const d2 = new Date(year, startMonthIndex + 2, 0);
      return `${d1.toLocaleString(i18n.language, { month: "short" })} - ${d2.toLocaleString(i18n.language, { month: "short" })} ${year}`;
    }
    return viewDate.toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [viewDate, activeTab, i18n.language]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetchGridStats({
          period: activeTab as any,
          date_str: dateStr,
          currency,
        });
        if (mounted) setBreakdownData(res);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    // Defer the fetch slightly to let the parent (Home) queue high-priority dashboard requests first.
    const tId = setTimeout(load, 100);
    return () => {
      mounted = false;
      clearTimeout(tId);
    };
  }, [activeTab, dateStr, currency]);

  useEffect(() => {
    let mounted = true;
    async function loadCycles() {
      setCyclesLoading(true);
      try {
        const res = await fetchCyclesSummary(cycleLimit, currency);
        if (mounted) setCyclesData(res.cycles);
      } catch (e) {
        console.error("Failed to load cycles summary:", e);
      } finally {
        if (mounted) setCyclesLoading(false);
      }
    }
    // Defer cycles load to prioritize dashboard requests
    const tId = setTimeout(loadCycles, 200);
    return () => {
      mounted = false;
      clearTimeout(tId);
    };
  }, [cycleLimit, currency]);

  // Use overviewData for the summary tiles if available, fallback to breakdownData
  const displayStats = useMemo(() => {
    return overviewData || breakdownData;
  }, [overviewData, breakdownData]);

  // Re-fetch if currency changes
  useEffect(() => {
    // This is handled by the main useEffects which invoke load() and loadCycles()
    // but we need to ensure they run when currency changes.
    // The dependency array of those effects should include currency.
  }, [currency]);

  // Transform data for chart based on period with gap filling
  const chartData = useMemo(() => {
    if (!breakdownData) return [];

    let raw: any[] = [];
    if (activeTab === "year") {
      raw =
        breakdownData.months && Array.isArray(breakdownData.months)
          ? breakdownData.months
          : breakdownData.days || [];
    } else if (activeTab === "day") {
      raw =
        breakdownData.hours && Array.isArray(breakdownData.hours)
          ? breakdownData.hours
          : breakdownData.days || [];
    } else if (activeTab === "month") {
      raw = Array.isArray(breakdownData.days)
        ? breakdownData.days
        : breakdownData.months || [];
    } else {
      raw =
        breakdownData.days || breakdownData.months || breakdownData.hours || [];
    }

    // Safety check to ensure raw is always an array
    if (!Array.isArray(raw)) raw = [];

    if (activeTab === "cycle") {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const startMonthIndex = Math.floor(month / 2) * 2;
      const start = new Date(year, startMonthIndex, 1);
      const end = new Date(year, startMonthIndex + 2, 0);

      const filled: any[] = [];
      const current = new Date(start);
      while (current <= end) {
        const dStr = current.toISOString().split("T")[0];
        const match = raw.find((r) => (r?.date || r?.month || r?.day) === dStr);
        filled.push({
          name: dStr.split("-").slice(1).join("/"),
          kwh: match ? (match as any).kwh || 0 : 0,
          cost: match
            ? ((match as any).bill_syp ??
              (match as any)["bill_NEW SYP"] ??
              (match as any)["bill NEW SYP"] ??
              (match as any)["bill_SYP NEW"] ??
              (match as any)["bill SYP NEW"] ??
              (match as any).bill_syp_new ??
              (match as any).bill_new ??
              (match as any).bill ??
              (match as any)["cost_SYP NEW"] ??
              (match as any)["cost SYP NEW"] ??
              (match as any).cost ??
              0)
            : 0,
        });
        current.setDate(current.getDate() + 1);
      }
      return filled;
    }

    if (activeTab === "month") {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();

      const filled: any[] = [];
      for (let d = 1; d <= lastDay; d++) {
        const dStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const match = raw.find((r) => (r?.date || r?.month || r?.day) === dStr);
        filled.push({
          name: `${String(month + 1).padStart(2, "0")}/${String(d).padStart(2, "0")}`,
          kwh: match ? (match as any).kwh || 0 : 0,
          cost: match
            ? ((match as any).bill_syp ??
              (match as any)["bill_NEW SYP"] ??
              (match as any)["bill NEW SYP"] ??
              (match as any)["bill_SYP NEW"] ??
              (match as any)["bill SYP NEW"] ??
              (match as any).bill_syp_new ??
              (match as any).bill_new ??
              (match as any).bill ??
              (match as any)["cost_SYP NEW"] ??
              (match as any)["cost SYP NEW"] ??
              (match as any).cost ??
              0)
            : 0,
        });
      }
      return filled;
    }

    if (activeTab === "year") {
      const year = viewDate.getFullYear();
      const filled: any[] = [];
      for (let m = 1; m <= 12; m++) {
        const mStrPadded = `${year}-${String(m).padStart(2, "0")}`;
        const mStrShort = `${year}-${m}`;
        const mStrSlash = `${year}/${String(m).padStart(2, "0")}`;
        const mStrSlashShort = `${year}/${m}`;

        // Find all records that match this month
        const matches = raw.filter((r) => {
          const val = r?.date || r?.month || r?.day;
          if (!val) return false;
          const d = String(val);
          return (
            d.startsWith(mStrPadded) ||
            d === mStrShort ||
            d.startsWith(`${mStrShort}-`) ||
            d.startsWith(mStrSlash) ||
            d === mStrSlashShort ||
            d.startsWith(`${mStrSlashShort}/`)
          );
        });

        const totalKwh = matches.reduce(
          (acc, curr) => acc + (curr.kwh || 0),
          0,
        );
        const totalCost = matches.reduce(
          (acc, curr) =>
            acc +
            ((curr as any).bill_syp ??
              (curr as any)["bill_SYP NEW"] ??
              (curr as any)["bill SYP NEW"] ??
              (curr as any).bill_syp_new ??
              (curr as any).bill_new ??
              (curr as any).bill ??
              (curr as any)["cost_SYP NEW"] ??
              (curr as any)["cost SYP NEW"] ??
              (curr as any).cost ??
              0),
          0,
        );

        filled.push({
          name: new Date(year, m - 1).toLocaleString(i18n.language, {
            month: "short",
          }),
          kwh: totalKwh,
          cost: totalCost,
        });
      }
      return filled;
    }

    if (activeTab === "day") {
      const filled: any[] = [];
      for (let h = 0; h < 24; h++) {
        const hLabel = `${String(h).padStart(2, "0")}:00`;
        const hPrefix = `${String(h).padStart(2, "0")}`; // e.g. "14"

        // Match against HH, HH:mm, or YYYY-MM-DD HH:mm:ss
        const matches = raw.filter((r) => {
          const val = r?.date || r?.hour || r?.time;
          if (!val) return false;
          const d = String(val);
          // 1. If date is just the hour "01", "02"...
          if (d === hPrefix || d === String(h)) return true;
          // 2. If date ends with or contains " 14:" or "T14:"
          if (d.includes(` ${hPrefix}:`) || d.includes(`T${hPrefix}:`))
            return true;
          // 3. Fallback check for "14:00"
          if (d.startsWith(hLabel)) return true;
          return false;
        });

        const totalKwh = matches.reduce(
          (acc, curr) => acc + (curr.kwh || 0),
          0,
        );
        const totalCost = matches.reduce(
          (acc, curr) =>
            acc +
            ((curr as any).bill_syp ??
              (curr as any)["bill_SYP NEW"] ??
              (curr as any)["bill SYP NEW"] ??
              (curr as any).bill_syp_new ??
              (curr as any).bill_new ??
              (curr as any).bill ??
              (curr as any)["cost_SYP NEW"] ??
              (curr as any)["cost SYP NEW"] ??
              (curr as any).cost ??
              0),
          0,
        );

        filled.push({
          name: hLabel,
          kwh: totalKwh,
          cost: totalCost,
        });
      }
      return filled;
    }

    const mappedRaw = Array.isArray(raw)
      ? raw.map((item) => {
          if (!item) return { name: "", kwh: 0, cost: 0 };
          const val =
            item.date ||
            item.month ||
            item.day ||
            item.hour ||
            item.time ||
            item.ref_date ||
            "";
          let name = String(val);
          try {
            if (activeTab === "day") {
              const parts = name.split(" ");
              name = parts.length > 1 ? parts[1].substring(0, 5) : name;
              if (!name.includes(":") && name.length <= 2) {
                name = name.padStart(2, "0") + ":00";
              }
            } else if (activeTab === "year" || activeTab === "month") {
              let dateStr = name;
              if (name.length <= 2) {
                dateStr = `${viewDate.getFullYear()}-${name.padStart(2, "0")}-01`;
              } else if (!name.includes("-") && !name.includes("/")) {
                dateStr = name + "-01";
              }

              const date = new Date(
                dateStr.includes("-")
                  ? dateStr
                  : dateStr.replace(/\//g, "-") +
                    (dateStr.length <= 7 ? "-01" : ""),
              );
              if (!isNaN(date.getTime())) {
                name = date.toLocaleString(i18n.language, {
                  month: activeTab === "year" ? "short" : "numeric",
                  day: activeTab === "month" ? "numeric" : undefined,
                });
              }
            }
          } catch (e) {}

          return {
            name,
            kwh: Number(item.kwh || item.usage || 0) || 0,
            cost: Number(item.bill_syp || item.cost || 0) || 0,
          };
        })
      : [];

    const hasData = (arr: any[]) => arr.some((v) => v.kwh > 0);

    if (activeTab === "year") {
      const year = viewDate.getFullYear();
      const filled: any[] = [];
      for (let m = 1; m <= 12; m++) {
        const mStrPadded = `${year}-${String(m).padStart(2, "0")}`;
        const mStrShort = `${year}-${m}`;
        const mStrSlash = `${year}/${String(m).padStart(2, "0")}`;

        const matches = raw.filter((r) => {
          const val = r?.date || r?.month || r?.day || r?.ref_date;
          if (!val) return false;
          const d = String(val);
          return (
            d.startsWith(mStrPadded) ||
            d === mStrShort ||
            d === String(m) ||
            d === String(m).padStart(2, "0") ||
            d.startsWith(mStrSlash)
          );
        });

        filled.push({
          name: new Date(year, m - 1).toLocaleString(i18n.language, {
            month: "short",
          }),
          kwh: matches.reduce(
            (acc, curr) => acc + (Number(curr.kwh || curr.usage || 0) || 0),
            0,
          ),
          cost: matches.reduce(
            (acc, curr) => acc + (Number(curr.bill_syp || curr.cost || 0) || 0),
            0,
          ),
        });
      }
      return hasData(filled) ? filled : mappedRaw;
    }

    if (activeTab === "day") {
      const filled: any[] = [];
      for (let h = 0; h < 24; h++) {
        const hLabel = `${String(h).padStart(2, "0")}:00`;
        const hPrefix = `${String(h).padStart(2, "0")}`;
        const matches = raw.filter((r) => {
          const val = r?.date || r?.hour || r?.time || r?.timestamp;
          if (!val) return false;
          const d = String(val);
          return (
            d === hPrefix ||
            d === String(h) ||
            d.includes(` ${hPrefix}:`) ||
            d.includes(`T${hPrefix}:`) ||
            d.startsWith(hLabel)
          );
        });

        filled.push({
          name: hLabel,
          kwh: matches.reduce(
            (acc, curr) => acc + (Number(curr.kwh || curr.usage || 0) || 0),
            0,
          ),
          cost: matches.reduce(
            (acc, curr) => acc + (Number(curr.bill_syp || curr.cost || 0) || 0),
            0,
          ),
        });
      }
      return hasData(filled) ? filled : mappedRaw;
    }

    return mappedRaw;
  }, [breakdownData, activeTab, viewDate, i18n.language]);

  return (
    <div className="flex flex-col gap-6">
      <Card className="relative overflow-hidden">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-6">
          <div className="flex-1">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {t("grid.title", "Grid Consumption")}
            </CardTitle>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center bg-muted rounded-lg p-1">
                <button
                  onClick={() => navigateDate(-1)}
                  className="p-1 hover:bg-background rounded transition-colors"
                  aria-label="Previous"
                >
                  {i18n.language === "ar" ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </button>
                <div className="px-3 flex items-center gap-2 text-sm font-semibold min-w-[120px] justify-center">
                  <Calendar className="h-3 w-3 opacity-50" />
                  {formattedViewDate}
                </div>
                <button
                  onClick={() => navigateDate(1)}
                  disabled={
                    viewDate >= new Date(new Date().setHours(0, 0, 0, 0))
                  }
                  className="p-1 hover:bg-background rounded transition-colors disabled:opacity-30"
                  aria-label="Next"
                >
                  {i18n.language === "ar" ? (
                    <ChevronLeft className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid w-full grid-cols-4 sm:w-auto">
              <TabsTrigger value="day">{t("common.day", "Day")}</TabsTrigger>
              <TabsTrigger value="month">
                {t("common.month", "Month")}
              </TabsTrigger>
              <TabsTrigger value="cycle">
                {t("common.cycle", "Cycle")}
              </TabsTrigger>
              <TabsTrigger value="year">{t("common.year", "Year")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-8">
          {loading ? (
            <div className="flex h-[350px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground opacity-20" />
            </div>
          ) : (
            <>
              <div className="h-[350px] w-full pt-2">
                {activeTab === "day" ? (
                  <div className="flex flex-col items-center justify-center h-full space-y-8 py-10 animate-in fade-in zoom-in duration-700">
                    <div className="text-center space-y-4">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-2">
                        <Zap className="h-3 w-3" />
                        {t("grid.daily_total", "Daily Consumption")}
                      </div>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-8xl font-black tracking-tighter tabular-nums text-foreground">
                          {(
                            breakdownData?.total_kwh ?? breakdownData?.kwh
                          )?.toFixed(1) || "0.0"}
                        </span>
                        <span className="text-2xl font-bold text-muted-foreground uppercase self-end mb-4">
                          {t("kWh")}
                        </span>
                      </div>
                    </div>

                    {(() => {
                      const val =
                        (breakdownData as any)?.bill_syp ??
                        (breakdownData as any)?.["bill_NEW SYP"] ??
                        (breakdownData as any)?.["bill NEW SYP"] ??
                        (breakdownData as any)?.["bill_SYP NEW"] ??
                        (breakdownData as any)?.["bill SYP NEW"] ??
                        (breakdownData as any)?.bill_syp_new ??
                        (breakdownData as any)?.bill_new ??
                        (breakdownData as any)?.bill ??
                        (breakdownData as any)?.["cost_NEW SYP"] ??
                        (breakdownData as any)?.["cost NEW SYP"] ??
                        (breakdownData as any)?.["cost_SYP NEW"] ??
                        (breakdownData as any)?.["cost SYP NEW"] ??
                        (breakdownData as any)?.cost_syp_new ??
                        (breakdownData as any)?.cost;
                      return val !== undefined ? (
                        <div className="relative group">
                          <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/10 rounded-[2.5rem] blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
                          <div className="relative bg-card/50 border border-primary/20 rounded-[2rem] px-12 py-6 text-center backdrop-blur-md shadow-xl">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60 block mb-2">
                              {t("grid.estimated_cost", "Estimated Cost")}
                            </span>
                            <span
                              className="text-5xl font-black tracking-tight"
                              style={{ color: getCostColor(val, currency) }}
                            >
                              {val.toLocaleString()}{" "}
                              <span className="text-xl font-bold opacity-70">
                                {currency}
                              </span>
                            </span>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                ) : chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 20, right: 10, left: -10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="barGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--primary)"
                            stopOpacity={0.8}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--primary)"
                            stopOpacity={0.3}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="var(--border)"
                        opacity={0.3}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={25}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${v.toFixed(1)}`}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--primary)", opacity: 0.1 }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-card/95 border border-border p-3 rounded-xl shadow-2xl backdrop-blur-md min-w-[120px]">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                                  {label}
                                </p>
                                <div className="space-y-1.5">
                                  <div className="flex flex-col">
                                    <span className="text-xs text-muted-foreground font-medium">
                                      {t("grid.usage", "Usage")}
                                    </span>
                                    <span className="text-lg font-black text-foreground leading-none">
                                      {data.kwh.toFixed(2)}{" "}
                                      <span className="text-[10px] font-bold text-muted-foreground">
                                        {t("kWh")}
                                      </span>
                                    </span>
                                  </div>
                                  {data.cost > 0 && (
                                    <div className="flex flex-col border-t border-border/50 pt-1.5">
                                      <span className="text-xs text-muted-foreground font-medium">
                                        {t("government.est_cost", "Cost")}
                                      </span>
                                      <span className="text-lg font-black text-primary leading-none">
                                        {data.cost.toLocaleString()}{" "}
                                        <span className="text-[10px] font-bold text-primary/70">
                                          {currency}
                                        </span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar
                        dataKey="kwh"
                        fill="url(#barGradient)"
                        stroke="var(--primary)"
                        strokeWidth={1}
                        radius={[6, 6, 0, 0]}
                        barSize={activeTab === "day" ? 12 : 24}
                        isAnimationActive={true}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                    <TrendingUp className="h-16 w-16 mb-4 opacity-10" />
                    <p className="text-sm font-medium">
                      {t("trends.no_data", "No trend data available")}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/50 pt-6">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("grid.period_total", "Period Total")}
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black tracking-tight text-foreground">
                      {(
                        breakdownData?.total_kwh ?? breakdownData?.kwh
                      )?.toFixed(1) || "0.0"}{" "}
                      <span className="text-sm font-medium text-muted-foreground">
                        {t("kWh")}
                      </span>
                    </span>
                    {(() => {
                      const val =
                        (breakdownData as any)?.bill_syp ??
                        (breakdownData as any)?.["bill_NEW SYP"] ??
                        (breakdownData as any)?.["bill NEW SYP"] ??
                        (breakdownData as any)?.["bill_SYP NEW"] ??
                        (breakdownData as any)?.["bill SYP NEW"] ??
                        (breakdownData as any)?.bill_syp_new ??
                        (breakdownData as any)?.bill_new ??
                        (breakdownData as any)?.bill ??
                        (breakdownData as any)?.["cost_NEW SYP"] ??
                        (breakdownData as any)?.["cost NEW SYP"] ??
                        (breakdownData as any)?.["cost_SYP NEW"] ??
                        (breakdownData as any)?.["cost SYP NEW"] ??
                        (breakdownData as any)?.cost;
                      return val !== undefined ? (
                        <span
                          className="text-lg font-bold"
                          style={{ color: getCostColor(val, currency) }}
                        >
                          {val.toLocaleString()} {currency}
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Standalone Current Grid Statistics Card */}
      <Card className="rounded-3xl border shadow-sm">
        <CardHeader className="pb-2 border-b bg-muted/20 backdrop-blur-sm">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            {t("grid.current_grid", "Current Grid Statistics")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <StatBox
              label={t("common.today", "Today")}
              value={`${(displayStats?.today?.kwh ?? (displayStats?.period === "day" ? displayStats?.kwh : undefined))?.toFixed(1) || "0.0"} ${t("kWh")}`}
              subValue={(() => {
                const today = displayStats?.today as any;
                const val =
                  today?.cost_syp_marginal ??
                  today?.cost_marginal ??
                  today?.cost ??
                  today?.bill_syp_standalone ??
                  today?.bill_standalone ??
                  (displayStats?.period === "day"
                    ? ((displayStats as any)?.bill_syp ??
                      (displayStats as any)?.bill)
                    : undefined);
                return val !== undefined && val !== null
                  ? `${val.toLocaleString()} ${currency}`
                  : "-";
              })()}
              subLabel={t("grid.marginal_cost", "Cost")}
              highlight={activeTab === "day"}
            />

            <StatBox
              label={t("common.this_month", "This Month")}
              value={`${displayStats?.month?.kwh?.toFixed(0) || "0"} ${t("kWh")}`}
              subValue={(() => {
                const month = displayStats?.month as any;
                const val =
                  month?.bill_syp_standalone ??
                  month?.bill_standalone ??
                  month?.bill_syp ??
                  month?.bill;
                return val !== undefined && val !== null
                  ? `${val.toLocaleString()} ${currency}`
                  : "-";
              })()}
              subLabel={t("grid.accumulated", "Accumulated")}
              highlight={activeTab === "month"}
            />

            <StatBox
              label={`${t("common.cycle", "Cycle")} (${displayStats?.cycle?.name || "-"})`}
              value={`${displayStats?.cycle?.kwh?.toFixed(0) || "0"} ${t("kWh")}`}
              subValue={(() => {
                const cycle = displayStats?.cycle as any;
                const val = cycle?.bill_syp ?? cycle?.bill ?? cycle?.cost;
                return val !== undefined && val !== null
                  ? `${val.toLocaleString()} ${currency}`
                  : "-";
              })()}
              subLabel={t("grid.current_bill", "Current Bill")}
              highlight={activeTab === "cycle"}
            />

            <div
              className={cn(
                "rounded-2xl border p-5 transition-all flex flex-col justify-between",
                activeTab === "year"
                  ? "bg-primary/5 border-primary/20 shadow-sm"
                  : "bg-card border-border/50 shadow-sm",
              )}
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  {t("common.year_total", "Year total")}
                </div>
                <div className="text-2xl font-black tracking-tight">
                  {displayStats?.year?.kwh?.toFixed(0) || "0"}{" "}
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("kWh")}
                  </span>
                </div>

                <div className="mt-2 text-lg font-bold text-primary">
                  {(() => {
                    const year = displayStats?.year as any;
                    const val =
                      year?.bill_syp_standalone ??
                      year?.bill_standalone ??
                      year?.bill_syp ??
                      year?.bill;
                    return val !== undefined && val !== null
                      ? `${val.toLocaleString()} ${currency}`
                      : "-";
                  })()}
                </div>
              </div>

              {displayStats?.insights && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-muted-foreground font-medium">
                      {t("grid.daily_avg", "Daily Avg")}:
                    </span>
                    <span className="font-bold text-foreground">
                      {displayStats.insights.daily_avg_kwh?.toFixed(1) || "0.0"}{" "}
                      {t("kWh")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-muted-foreground font-medium">
                      {t("grid.grid_avail", "Grid Avail")}:
                    </span>
                    <span className="font-bold text-foreground">
                      {displayStats.insights.avg_grid_hours?.toFixed(1) ||
                        "0.0"}{" "}
                      {t("h_day")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <StatBox
              label={t("grid.lifetime_total", "Lifetime Total")}
              value={`${displayStats?.total?.kwh?.toFixed(0) || "0"} ${t("kWh")}`}
              subValue={(() => {
                const total = displayStats?.total as any;
                const val =
                  total?.bill_syp_standalone ??
                  total?.bill_standalone ??
                  total?.bill_syp ??
                  total?.bill;
                return val !== undefined && val !== null
                  ? `${val.toLocaleString()} ${currency}`
                  : "-";
              })()}
              subLabel={t("grid.accumulated", "Accumulated")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Cycles Summary Card */}
      <Card className="rounded-3xl border shadow-sm overflow-hidden">
        <CardHeader className="pb-4 border-b bg-muted/20 backdrop-blur-sm flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            {t("grid.cycles_summary", "Cycles Summary")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {t("grid.limit", "Show")}:
            </span>
            <Select
              value={String(cycleLimit)}
              onValueChange={(v) => setCycleLimit(Number(v))}
            >
              <SelectTrigger className="w-[70px] h-8 rounded-lg bg-background border-border/50">
                <SelectValue placeholder="5" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {cyclesLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground opacity-20" />
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {Array.isArray(cyclesData) && cyclesData.length > 0 ? (
                cyclesData.map((cycle, idx) => {
                  if (!cycle) return null;
                  return (
                    <div
                      key={cycle.cycle_start + idx}
                      className="p-6 hover:bg-muted/10 transition-colors"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="font-bold text-lg">
                              {cycle.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <LayoutGrid className="h-3 w-3" />
                              {cycle?.kwh?.toFixed(1) ?? "0.0"} {t("kWh")}
                            </span>
                            <span className="font-medium text-primary bg-primary/5 px-2 py-0.5 rounded-full">
                              {(
                                (cycle as any)?.bill_syp ??
                                (cycle as any)?.bill ??
                                (cycle as any)?.cost ??
                                0
                              ).toLocaleString()}{" "}
                              {currency}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {Array.isArray(cycle.tiers) &&
                            cycle.tiers.map((tier, tidx) => {
                              if (!tier) return null;
                              return (
                                <div
                                  key={tidx}
                                  className={cn(
                                    "flex flex-col px-3 py-2 rounded-xl text-[10px] border min-w-[80px]",
                                    tier.filled > 0
                                      ? "bg-primary/[0.03] border-primary/20"
                                      : "bg-muted/20 border-border/50 opacity-40",
                                  )}
                                >
                                  <span className="text-muted-foreground uppercase font-bold tracking-tighter mb-1">
                                    {tidx === 0
                                      ? t("grid.tier1", "Tier 1")
                                      : t("grid.tier2", "Tier 2")}
                                  </span>
                                  <span className="text-sm font-black leading-none">
                                    {tier?.filled?.toFixed(1) ?? "0.0"}
                                    <span className="text-[10px] font-medium opacity-60 ml-0.5">
                                      /{tier?.limit === "∞" ? "∞" : tier.limit}
                                    </span>
                                  </span>
                                  <span className="mt-1 text-primary/80 font-bold">
                                    {tier?.price ?? "0"} {currency}/kWh
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-10 text-center text-muted-foreground">
                  {t("grid.no_cycles", "No cycle history available")}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value, subValue, subLabel, highlight }: any) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 transition-all",
        highlight
          ? "bg-primary/5 border-primary/20 shadow-sm"
          : "bg-card border-border/50 shadow-sm",
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {label}
      </div>
      <div className="text-2xl font-black tracking-tight">{value}</div>
      <div className="mt-4 pt-4 border-t border-border/50">
        <div className="text-lg font-bold text-primary">{subValue}</div>
        {subLabel && (
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {subLabel}
          </div>
        )}
      </div>
    </div>
  );
}
