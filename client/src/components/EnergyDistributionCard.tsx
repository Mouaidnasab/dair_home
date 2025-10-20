import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Home, Battery, Zap } from "lucide-react";
import { formatPower, formatEnergy } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { DashboardData } from "@/types/energy";

interface EnergyDistributionCardProps {
  data: DashboardData;
}

export default function EnergyDistributionCard({ data }: EnergyDistributionCardProps) {
  const { t } = useLanguage();

  // Calculate total PV power from both inverters
  const totalPvPower = data.inverters.groundFloor.pvNowW + data.inverters.firstFloor.pvNowW;
  
  // Calculate total home load from both inverters
  const totalHomeLoad = data.inverters.groundFloor.loadW + data.inverters.firstFloor.loadW;
  
  // Grid power (positive = importing, negative = exporting)
  const gridPower = data.inverters.groundFloor.gridW + data.inverters.firstFloor.gridW;
  
  // Battery power (positive = charging, negative = discharging)
  const batteryPower = data.battery.powerW;

  // Determine if electricity is coming from grid (positive grid power)
  const isGridIncoming = gridPower > 0;

  return (
    <Card className="col-span-full" data-testid="energy-distribution">
      <CardHeader>
        <CardTitle>{t("energy_distribution.title") || "Energy Distribution"}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col items-center justify-center space-y-8">
          {/* Title and Indicator */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <div
                className={`h-3 w-3 rounded-full ${
                  isGridIncoming ? "bg-blue-500 animate-pulse" : "bg-gray-500"
                }`}
              />
              <span className="text-sm font-medium text-muted-foreground">
                {isGridIncoming ? "Electricity incoming" : "No incoming electricity"}
              </span>
            </div>
          </div>

          {/* Energy Flow Diagram */}
          <div className="relative w-full h-96 flex items-center justify-center">
            <svg
              viewBox="0 0 400 400"
              className="w-full h-full max-w-md"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Connection lines */}
              {/* Solar to Home */}
              <line
                x1="200"
                y1="80"
                x2="200"
                y2="140"
                stroke="#fbbf24"
                strokeWidth="3"
              />
              {/* Solar to Battery */}
              <line
                x1="200"
                y1="80"
                x2="200"
                y2="280"
                stroke="#fbbf24"
                strokeWidth="3"
              />
              {/* Grid to Home */}
              <line
                x1="80"
                y1="200"
                x2="140"
                y2="200"
                stroke={isGridIncoming ? "#3b82f6" : "#10b981"}
                strokeWidth="3"
              />
              {/* Home to Battery */}
              <line
                x1="200"
                y1="200"
                x2="200"
                y2="280"
                stroke="#ef4444"
                strokeWidth="3"
              />
              {/* Battery to Grid */}
              <line
                x1="200"
                y1="320"
                x2="80"
                y2="320"
                stroke={batteryPower > 0 ? "#3b82f6" : "#10b981"}
                strokeWidth="3"
              />
              {/* Home to Grid */}
              <line
                x1="200"
                y1="200"
                x2="80"
                y2="200"
                stroke={totalPvPower > totalHomeLoad ? "#10b981" : "#3b82f6"}
                strokeWidth="3"
              />

              {/* Connection dots */}
              <circle cx="200" cy="140" r="4" fill="#fbbf24" />
              <circle cx="140" cy="200" r="4" fill={isGridIncoming ? "#3b82f6" : "#10b981"} />
              <circle cx="200" cy="200" r="6" fill="#ef4444" />
              <circle cx="200" cy="280" r="4" fill="#fbbf24" />

              {/* Solar Circle (Top) */}
              <circle
                cx="200"
                cy="60"
                r="35"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="3"
              />
              <g transform="translate(200, 60)">
                <Sun className="h-6 w-6 text-yellow-500" x="-12" y="-12" />
              </g>

              {/* Grid Circle (Left) */}
              <circle
                cx="80"
                cy="200"
                r="35"
                fill="none"
                stroke={isGridIncoming ? "#3b82f6" : "#10b981"}
                strokeWidth="3"
              />
              <g transform="translate(80, 200)">
                <Zap className="h-6 w-6 text-blue-500" x="-12" y="-12" />
              </g>

              {/* Home Circle (Right) */}
              <circle
                cx="320"
                cy="200"
                r="35"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="3"
              />
              <g transform="translate(320, 200)">
                <Home className="h-6 w-6 text-cyan-500" x="-12" y="-12" />
              </g>

              {/* Battery Circle (Bottom) */}
              <circle
                cx="200"
                cy="320"
                r="35"
                fill="none"
                stroke="#ec4899"
                strokeWidth="3"
              />
              <g transform="translate(200, 320)">
                <Battery className="h-6 w-6 text-pink-500" x="-12" y="-12" />
              </g>
            </svg>
          </div>

          {/* Energy Values Grid */}
          <div className="grid grid-cols-2 gap-6 w-full">
            {/* Solar */}
            <div className="flex flex-col items-center space-y-2">
              <div className="text-sm text-muted-foreground">Solar</div>
              <div className="text-xl font-bold text-yellow-500">{formatPower(totalPvPower)}</div>
            </div>

            {/* Grid */}
            <div className="flex flex-col items-center space-y-2">
              <div className="text-sm text-muted-foreground">
                {isGridIncoming ? "Grid (In)" : "Grid (Out)"}
              </div>
              <div className={`text-xl font-bold ${isGridIncoming ? "text-blue-500" : "text-green-500"}`}>
                {formatPower(Math.abs(gridPower))}
              </div>
            </div>

            {/* Home Load */}
            <div className="flex flex-col items-center space-y-2">
              <div className="text-sm text-muted-foreground">Home Load</div>
              <div className="text-xl font-bold text-red-500">{formatPower(totalHomeLoad)}</div>
            </div>

            {/* Battery */}
            <div className="flex flex-col items-center space-y-2">
              <div className="text-sm text-muted-foreground">
                {batteryPower > 0 ? "Battery (↑ Charging)" : "Battery (↓ Discharging)"}
              </div>
              <div className={`text-xl font-bold ${batteryPower > 0 ? "text-green-500" : "text-pink-500"}`}>
                {formatPower(Math.abs(batteryPower))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="w-full border-t border-border pt-4 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-2 w-4 bg-yellow-500 rounded" />
              <span>Solar generation</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-4 rounded ${isGridIncoming ? "bg-blue-500" : "bg-green-500"}`} />
              <span>{isGridIncoming ? "Grid import" : "Grid export"}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-4 bg-red-500 rounded" />
              <span>Home consumption</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-4 bg-pink-500 rounded" />
              <span>Battery charge/discharge</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

