import { useState, useEffect, useMemo } from "react";
import {
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { TimeSeriesPoint } from "@/types/energy";
import { formatPower } from "@/lib/utils";

/** Types */
interface TrendsCardProps {
  homeSeries: TimeSeriesPoint[];
  groundFloorSeries: TimeSeriesPoint[];
  firstFloorSeries: TimeSeriesPoint[];
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
  i18n: any;
}

/** Small, SSR-safe media query hook */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const get = () =>
      typeof window !== "undefined" && window.innerWidth <= breakpoint;
    const onResize = () => setIsMobile(get());
    setIsMobile(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

/** Tooltip (RTL/LTR aware + SOC formatting) */
function CustomTooltip({ active, payload, label, i18n }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const dir = typeof i18n?.dir === "function" ? i18n.dir() : "ltr";

  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-2 space-y-1">
        {payload.map((entry, idx) => {
          const name = entry?.name ?? "";
          const isSoc =
            name.toLowerCase().includes("soc") || name.includes("نسبة الشحن");

          return (
            <p key={idx} className="text-sm" style={{ color: entry.color }}>
              {dir === "ltr" ? `${name}: ` : ""}
              {isSoc ? `${entry.value}%` : formatPower(entry.value)}
              {dir === "rtl" ? ` : ${name}` : ""}
            </p>
          );
        })}
      </div>
    </div>
  );
}

/** Date helpers */
function toInputDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromInputDateString(v: string) {
  return new Date(`${v}T00:00:00`);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isAfterToday(d: Date, today: Date) {
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const tt = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return dd.getTime() > tt.getTime();
}
function clampToToday(d: Date, today: Date) {
  return isAfterToday(d, today) ? today : d;
}

/** Series registry (single source of truth) */
type SeriesKey =
  | "homePvPower"
  | "loadPower"
  | "batteryPower"
  | "gridPower"
  | "batterySoc";

type SeriesConfig = {
  key: SeriesKey;
  color: string;
  kind: "area" | "line";
  yAxis: "left" | "right";
  labelKey: string;
  gradientId?: string;
};

export default function TrendsCard({
  homeSeries,
  groundFloorSeries,
  firstFloorSeries,
  selectedDate,
  onDateChange,
}: TrendsCardProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState("home");

  /** Mobile: tweak Y-axis ticks/labels only. Do not unmount or set width=0. */
  const isMobile = useIsMobile(768);

  /** Filterable series */
  const SERIES: SeriesConfig[] = useMemo(
    () => [
      {
        key: "homePvPower",
        color: "#fbbf24",
        kind: "area",
        yAxis: "left",
        labelKey: "legend.pv_power",
        gradientId: "colorPv",
      },
      {
        key: "loadPower",
        color: "#ef4444",
        kind: "area",
        yAxis: "left",
        labelKey: "legend.load",
        gradientId: "colorLoad",
      },
      {
        key: "batteryPower",
        color: "#3b82f6",
        kind: "area",
        yAxis: "left",
        labelKey: "legend.battery",
        gradientId: "colorBattery",
      },
      {
        key: "gridPower",
        color: "#10b981",
        kind: "line",
        yAxis: "left",
        labelKey: "legend.grid",
      },
      {
        key: "batterySoc",
        color: "#06b6d4",
        kind: "line",
        yAxis: "right",
        labelKey: "legend.soc",
      },
    ],
    [t]
  );

  /** Enabled map (all enabled by default) */
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    homePvPower: true,
    loadPower: true,
    batteryPower: true,
    gridPower: true,
    batterySoc: true,
  });

  /** Controlled/Uncontrolled date handling */
  const [internalDate, setInternalDate] = useState<Date>(
    selectedDate ?? new Date()
  );
  useEffect(() => {
    if (selectedDate) setInternalDate(selectedDate);
  }, [selectedDate]);
  const isControlled = typeof onDateChange === "function";
  const today = useMemo(() => new Date(), []);
  const currentDate = clampToToday(internalDate, today);
  const isToday = useMemo(
    () => sameDay(currentDate, today),
    [currentDate, today]
  );
  const handleDateChange = (nextRaw: Date) => {
    const next = clampToToday(nextRaw, today);
    if (isControlled && onDateChange) onDateChange(next);
    else setInternalDate(next);
  };
  const nextIsFuture = isAfterToday(addDays(currentDate, 1), today);

  /** Filtering controls */
  const setAll = (value: boolean) => {
    setEnabled((prev) => {
      const out: Record<SeriesKey, boolean> = { ...prev } as any;
      SERIES.forEach((s) => (out[s.key] = value));
      return out;
    });
  };
  const toggleKey = (key: SeriesKey) =>
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));

  /** Chart renderer */
  const renderChart = (data: TimeSeriesPoint[]) => {
    if (!data || data.length === 0) {
      return (
        <div className="flex h-80 items-center justify-center text-muted-foreground">
          {t("trends.no_data")}
        </div>
      );
    }

    const formattedData = data.map((point) => ({
      ...point,
      timestamp: new Date(point.timestamp).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
      }),
    }));

    const anyOn = SERIES.some((s) => enabled[s.key]);
    if (!anyOn) {
      return (
        <div className="flex h-80 items-center justify-center text-muted-foreground">
          {t("trends.no_series_selected", "No series selected")}
        </div>
      );
    }

    /** Mobile-only axis visibility (no unmount/collapse) */
    const leftKeys: SeriesKey[] = [
      "homePvPower",
      "loadPower",
      "batteryPower",
      "gridPower",
    ];
    const leftAnyEnabled = leftKeys.some((k) => enabled[k]);
    const socEnabled = enabled.batterySoc;

    const mobileLeftTick =
      isMobile && !leftAnyEnabled ? false : { fill: "currentColor" };
    const mobileRightTick =
      isMobile && !socEnabled ? false : { fill: "currentColor" };

    const margin = isMobile
      ? { top: 5, right: 12, left: 8, bottom: 5 }
      : { top: 5, right: 30, left: 0, bottom: 5 };

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={formattedData} margin={margin}>
          <defs>
            <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorBattery" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />

          <XAxis
            dataKey="timestamp"
            className="text-xs"
            tick={{ fill: "currentColor" }}
          />

          {/* Left Y: desktop label; mobile no title and tick off if no left series */}
          <YAxis
            yAxisId="left"
            className="text-xs"
            tick={mobileLeftTick}
            label={
              isMobile
                ? undefined
                : {
                    value: t("trends.power_label"),
                    angle: -90,
                    position: "insideLeft",
                  }
            }
          />

          {/* Right Y: desktop label; mobile shows ticks only if SOC enabled, no title */}
          <YAxis
            yAxisId="right"
            orientation="right"
            className="text-xs"
            tick={mobileRightTick}
            label={
              isMobile
                ? undefined
                : {
                    value: t("trends.soc_label"),
                    angle: 90,
                    position: "insideRight",
                  }
            }
          />

          <Tooltip content={<CustomTooltip i18n={i18n} />} />
          <Legend onClick={() => {}} />

          {SERIES.map((s) => {
            const common = {
              key: s.key,
              dataKey: s.key,
              stroke: s.color,
              strokeWidth: 2,
              name: t(s.labelKey),
              dot: false as const,
              isAnimationActive: false,
              hide: !enabled[s.key],
              yAxisId: s.yAxis,
            };
            return s.kind === "area" ? (
              <Area
                {...common}
                type="monotone"
                fill={s.gradientId ? `url(#${s.gradientId})` : s.color}
              />
            ) : (
              <Line {...common} type="monotone" />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <Card className="col-span-full" data-testid="trends-home">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle>{t("trends.title")}</CardTitle>

        {/* Date Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={() => handleDateChange(addDays(currentDate, -1))}
            aria-label="Previous day"
          >
            {i18n.dir() === "rtl" ? "▶︎" : "◀"}
          </button>

          <input
            type="date"
            className="rounded border px-3 py-2 text-sm"
            value={toInputDateString(currentDate)}
            max={toInputDateString(today)}
            onChange={(e) => {
              if (!e.target.value) return;
              const next = fromInputDateString(e.target.value);
              if (!isNaN(next.getTime())) handleDateChange(next);
            }}
            aria-label="Select date"
          />

          <button
            type="button"
            className={`rounded border px-3 py-2 text-sm ${
              isAfterToday(addDays(currentDate, 1), today)
                ? "opacity-50 pointer-events-none"
                : ""
            }`}
            onClick={() => {
              const candidate = addDays(currentDate, 1);
              if (!isAfterToday(candidate, today)) handleDateChange(candidate);
            }}
            aria-label="Next day"
            aria-disabled={isAfterToday(addDays(currentDate, 1), today)}
            disabled={isAfterToday(addDays(currentDate, 1), today)}
            title={
              isAfterToday(addDays(currentDate, 1), today)
                ? t("common.not_allowed", "Not allowed")
                : undefined
            }
          >
            {i18n.dir() === "rtl" ? "◀" : "▶︎"}
          </button>

          {!isToday && (
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={() => handleDateChange(today)}
            >
              {t("common.today", "Today")}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Filter Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("trends.show_series", "Show series")}:
          </span>

          {SERIES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => toggleKey(s.key)}
              className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${
                enabled[s.key]
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-background border-border text-muted-foreground"
              }`}
              aria-pressed={enabled[s.key]}
              aria-label={`toggle ${t(s.labelKey)}`}
              title={t(s.labelKey)}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {t(s.labelKey)}
            </button>
          ))}

          <div className="ml-2 flex gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => setAll(true)}
            >
              {t("common.select_all", "Select all")}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => setAll(false)}
            >
              {t("common.select_none", "None")}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="home">{t("trends.home")}</TabsTrigger>
            <TabsTrigger value="ground">{t("trends.ground_floor")}</TabsTrigger>
            <TabsTrigger value="first">{t("trends.first_floor")}</TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="mt-6">
            {renderChart(homeSeries)}
          </TabsContent>
          <TabsContent value="ground" className="mt-6">
            {renderChart(groundFloorSeries)}
          </TabsContent>
          <TabsContent value="first" className="mt-6">
            {renderChart(firstFloorSeries)}
          </TabsContent>
        </Tabs>

        <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            <strong>{t("trends.home")}:</strong> {t("trends.home_desc")}
          </p>
          <p>
            <strong>
              {t("trends.ground_floor")} / {t("trends.first_floor")}:
            </strong>{" "}
            {t("trends.floor_desc")}
          </p>
          <p>
            <strong>{t("legend.soc")}:</strong> {t("trends.soc_desc")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
