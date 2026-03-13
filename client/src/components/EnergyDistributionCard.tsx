import { Card, CardContent } from "@/components/ui/card";
import { Sun, Home, Battery, Zap, ZapOff } from "lucide-react";
import { cn, formatPower, getBatteryColor } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { DashboardData } from "@/types/energy";

interface EnergyDistributionCardProps {
  data: DashboardData;
}

export default function EnergyDistributionCard({
  data,
}: EnergyDistributionCardProps) {
  const { t } = useTranslation();

  // 1. Data Aggregation
  const totalPvPower =
    data.inverters.groundFloor.pvNowW + data.inverters.firstFloor.pvNowW;
  const totalHomeLoad =
    data.inverters.groundFloor.loadW + data.inverters.firstFloor.loadW;
  const gridPower =
    data.inverters.groundFloor.gridW + data.inverters.firstFloor.gridW; // + = Import, - = Export
  const batteryPower = data.battery.powerW; // + = Charging, - = Discharging
  const soc = data.battery.soc;

  // 2. Flow Detection
  const hasSolar = totalPvPower > 10;
  const hasGridImport = gridPower > 10;
  const hasGridExport = gridPower < -10;
  const hasBatteryCharge = batteryPower > 10;
  const hasBatteryDischarge = batteryPower < -10;
  const hasHomeLoad = totalHomeLoad > 10;

  // 3. Logic: Where is the energy going? (Simplified Flow Model)
  const isSolarToHome = hasSolar && hasHomeLoad;
  const isSolarToBattery = hasSolar && hasBatteryCharge;
  const isSolarToGrid = hasSolar && hasGridExport;

  const isGridToHome = hasGridImport && totalHomeLoad > totalPvPower;
  const isGridToBattery = hasGridImport && hasBatteryCharge && !hasSolar;

  const isBatteryToHome = hasBatteryDischarge && hasHomeLoad;
  const isBatteryToGrid = hasBatteryDischarge && hasGridExport;

  return (
    <Card
      className="col-span-full overflow-hidden relative border shadow-sm transition-shadow hover:shadow-md h-full"
      data-testid="energy-distribution"
    >
      {/* Dynamic Background Glow */}
      <div className="absolute inset-0 pointer-events-none transition-opacity duration-1000 opacity-20 dark:opacity-10">
        <div
          className={`absolute -top-1/2 left-1/4 w-1/2 h-full bg-yellow-400/30 blur-[100px] transition-all duration-1000 ${hasSolar ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
        />
        <div
          className={`absolute -bottom-1/2 right-1/4 w-1/2 h-full bg-cyan-400/30 blur-[100px] transition-all duration-1000 ${hasHomeLoad ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
        />
        <div
          className={`absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-500/30 blur-[100px] transition-all duration-1000 ${hasGridImport ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
        />
      </div>

      <CardContent className="p-6 relative">
        {/* Electricity Status Indicator (Moved from Header) */}
        {/* Responsive Aspect Ratio Container */}
        <div className="relative w-full aspect-video">
          {/* Layer 1: SVG Flow Lines (Background) */}
          <div className="absolute inset-0">
            <svg
              viewBox="0 0 400 225"
              className="w-full h-full"
              style={{ overflow: "visible" }}
            >
              <defs>
                <linearGradient
                  id="gradient-yellow"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#EAB308" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#EAB308" stopOpacity="0.1" />
                </linearGradient>
              </defs>

              {/* 1. Solar -> Home (Updated start y to 56) */}
              <FlowPath
                active={isSolarToHome}
                d="M200,56 C200,80 340,80 340,113"
                color="text-yellow-500"
              />

              {/* 2. Solar -> Battery (Updated start y to 56) */}
              <FlowPath
                active={isSolarToBattery}
                d="M200,56 L200,191"
                color="text-yellow-500"
              />

              {/* 3. Solar -> Grid (Updated start y to 56) */}
              <FlowPath
                active={isSolarToGrid}
                d="M200,56 C200,80 60,80 60,113"
                color="text-yellow-500"
              />

              {/* 4. Grid -> Home */}
              <FlowPath
                active={isGridToHome}
                d="M60,113 L340,113"
                color="text-blue-500"
                dashed
              />

              {/* 5. Grid -> Battery */}
              <FlowPath
                active={isGridToBattery}
                d="M60,113 C60,153 200,153 200,191"
                color="text-blue-500"
              />

              {/* 6. Battery -> Home */}
              <FlowPath
                active={isBatteryToHome}
                d="M200,191 C200,153 340,153 340,113"
                color="text-pink-500"
              />
            </svg>
          </div>

          {/* Layer 2: HTML Nodes (Foreground) */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Solar Node (Top Center: 50% 25% - pushed down to avoid overlap) */}
            <div className="absolute top-[25%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0">
              <EnergyNode
                icon={Sun}
                label={t("energy_distribution.solar")}
                value={totalPvPower}
                colorClass="text-yellow-500"
                bgClass="bg-yellow-500/10"
                borderClass="border-yellow-500"
                active={hasSolar}
              />
            </div>

            {/* Grid Node (Left Center: 15% 50%) */}
            <div className="absolute top-1/2 left-[15%] -translate-x-1/2 -translate-y-1/2 w-0 h-0">
              <EnergyNode
                icon={Zap}
                label={t("energy_distribution.grid")}
                value={Math.abs(gridPower)}
                colorClass={hasGridExport ? "text-green-500" : "text-blue-500"}
                bgClass={hasGridExport ? "bg-green-500/10" : "bg-blue-500/10"}
                borderClass={
                  hasGridExport ? "border-green-500" : "border-blue-500"
                }
                active={hasGridImport || hasGridExport}
                subLabel={
                  hasGridExport
                    ? t("energy_distribution.export")
                    : hasGridImport
                      ? t("energy_distribution.import")
                      : ""
                }
              >
                {/* Electricity Status Overlay (Top-Right of Grid Icon) */}
                <div
                  className={cn(
                    "absolute -top-3 -right-3 z-30 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-500 shadow-sm border bg-background/90 backdrop-blur-sm",
                    data.grid.isPowerOn
                      ? "text-green-600 border-green-500/20"
                      : "text-red-600 border-red-500/20",
                  )}
                >
                  {data.grid.isPowerOn ? "ON" : "OFF"}
                </div>
              </EnergyNode>
            </div>

            {/* Home Node (Right Center: 85% 50%) */}
            <div className="absolute top-1/2 left-[85%] -translate-x-1/2 -translate-y-1/2 w-0 h-0">
              <EnergyNode
                icon={Home}
                label={t("energy_distribution.home_load")}
                value={totalHomeLoad}
                colorClass="text-cyan-500"
                bgClass="bg-cyan-500/10"
                borderClass="border-cyan-500"
                active={hasHomeLoad}
              />
            </div>

            {/* Battery Node (Bottom Center: 50% 85%) */}
            <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0">
              <EnergyNode
                icon={Battery}
                label={t("energy_distribution.battery")}
                value={Math.abs(batteryPower)}
                colorClass={
                  hasBatteryCharge ? "text-green-500" : "text-pink-500"
                }
                bgClass={
                  hasBatteryCharge ? "bg-green-500/10" : "bg-pink-500/10"
                }
                borderClass={
                  hasBatteryCharge ? "border-green-500" : "border-pink-500"
                }
                active={hasBatteryCharge || hasBatteryDischarge}
              >
                {/* Extra SOC Badge with dynamic color gradient */}
                <div
                  className="absolute -top-1 -right-2 z-30 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-black text-white shadow-md ring-2 ring-background tabular-nums animate-in zoom-in duration-300"
                  style={{ backgroundColor: getBatteryColor(soc) }}
                >
                  {soc}%
                </div>
              </EnergyNode>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Subcomponents ---

function FlowPath({
  d,
  color,
  active,
  dashed,
}: {
  d: string;
  color: string;
  active: boolean;
  dashed?: boolean;
}) {
  if (!active)
    return (
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted/10"
      />
    );

  return (
    <>
      {/* Glow underlay */}
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        className={`${color} opacity-20 blur-[2px]`}
      />
      {/* Animated dashed line */}
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`${color} animate-energy-flow`}
        strokeDasharray={dashed ? "5 5" : "10 10"}
        strokeLinecap="round"
      />
    </>
  );
}

function EnergyNode({
  icon: Icon,
  label,
  value,
  colorClass,
  bgClass,
  borderClass,
  active,
  subLabel,
  children,
}: any) {
  return (
    // This container is 0x0 size and absolutely centered.
    // Everything else flows out from this center point.
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="relative flex items-center justify-center w-0 h-0">
        {/* Icon Container (Target for lines) */}
        <div className="absolute pointer-events-auto flex items-center justify-center">
          <div
            className={`relative p-3 rounded-full transition-all duration-500 flex items-center justify-center 
            ${active ? `border-2 ${borderClass} shadow-lg` : "border-2 border-muted"}`}
          >
            {/* Solid background mask */}
            <div className="absolute inset-0 rounded-full bg-card" />

            {/* Background overlay */}
            <div
              className={`absolute inset-0 rounded-full transition-colors duration-500 ${active ? bgClass : "bg-muted/10"}`}
            />

            {active && (
              <div
                className={`absolute inset-0 rounded-full animate-pulse-ring ${bgClass}`}
              />
            )}

            <Icon
              className={`relative z-10 w-6 h-6 transition-colors duration-500 ${active ? colorClass : "text-muted-foreground"}`}
            />
            {children}
          </div>
        </div>

        {/* Value Badge (Absolute positioned below center) */}
        <div className="absolute top-[32px] left-1/2 -translate-x-1/2 text-center whitespace-nowrap z-20 pointer-events-auto">
          <div className="inline-block px-2.5 py-1 rounded-full bg-card/90 backdrop-blur-md border shadow-sm">
            <div
              className={`text-sm font-bold font-mono leading-none transition-colors duration-500 ${active ? "text-foreground" : "text-muted-foreground"}`}
            >
              {formatPower(value)}
            </div>
          </div>

          {subLabel && (
            <div className="mt-1 text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider opacity-70 bg-card/50 px-1.5 py-0.5 rounded border border-transparent">
                {subLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
