import { useState } from "react";
import {
  AreaChart,
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
import { useLanguage } from "@/contexts/LanguageContext";
import { TimeSeriesPoint } from "@/types/energy";
import { formatPower, formatEnergy } from "@/lib/utils";

interface TrendsCardProps {
  homeSeries: TimeSeriesPoint[];
  groundFloorSeries: TimeSeriesPoint[];
  firstFloorSeries: TimeSeriesPoint[];
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload) return null;

  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium text-foreground">
        {new Date(label || "").toLocaleTimeString()}
      </p>
      <div className="mt-2 space-y-1">
        {payload.map((entry, idx) => (
          <p key={idx} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {entry.name.includes("SOC") ? `${entry.value}%` : formatPower(entry.value)}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function TrendsCard({
  homeSeries,
  groundFloorSeries,
  firstFloorSeries,
}: TrendsCardProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("home");

  const renderChart = (data: TimeSeriesPoint[]) => {
    if (!data || data.length === 0) {
      return (
        <div className="flex h-80 items-center justify-center text-muted-foreground">
          {t("trends.no_data")}
        </div>
      );
    }

    // Format data for display
    const formattedData = data.map((point) => ({
      ...point,
      timestamp: new Date(point.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart
          data={formattedData}
          margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
        >
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
          <YAxis
            yAxisId="left"
            className="text-xs"
            tick={{ fill: "currentColor" }}
            label={{ value: t("trends.power_label"), angle: -90, position: "insideLeft" }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            className="text-xs"
            tick={{ fill: "currentColor" }}
            label={{ value: t("trends.soc_label"), angle: 90, position: "insideRight" }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />

          {/* Power areas */}
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="homePvPower"
            stroke="#fbbf24"
            strokeWidth={2}
            fill="url(#colorPv)"
            name={t("legend.pv_power")}
            isAnimationActive={false}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="loadPower"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#colorLoad)"
            name={t("legend.load")}
            isAnimationActive={false}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="batteryPower"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#colorBattery)"
            name={t("legend.battery")}
            isAnimationActive={false}
          />

          {/* Grid and Generator lines */}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="gridPower"
            stroke="#10b981"
            strokeWidth={2}
            name={t("legend.grid")}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="genPower"
            stroke="#8b5cf6"
            strokeWidth={2}
            name={t("legend.generator")}
            dot={false}
            isAnimationActive={false}
          />

          {/* SOC line on right axis */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="batterySoc"
            stroke="#06b6d4"
            strokeWidth={2}
            name={t("legend.soc")}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <Card className="col-span-full" data-testid="trends-home">
      <CardHeader>
        <CardTitle>{t("trends.title")}</CardTitle>
      </CardHeader>

      <CardContent>
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
            <strong>{t("trends.ground_floor")} / {t("trends.first_floor")}:</strong> {t("trends.floor_desc")}
          </p>
          <p>
            <strong>{t("legend.soc")}:</strong> {t("trends.soc_desc")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

