import { Battery, Home as HomeIcon, Sun, Zap, type LucideIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatPower } from "@/lib/utils";
import type { SystemLive } from "@/types/energy";

const ACTIVE_W = 10;

/** Red (0%) -> yellow (20%) -> green (100%). */
function batteryColor(soc: number): string {
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const [r, g, b] = soc <= 20 ? mix([239, 68, 68], [234, 179, 8], soc / 20) : mix([234, 179, 8], [34, 197, 94], Math.min((soc - 20) / 80, 1));
  return `rgb(${r}, ${g}, ${b})`;
}

function EnergyFlowCard({ system }: { system: SystemLive }) {
  const { t } = useTranslation();
  const pv = system.pv_w ?? 0;
  const load = system.load_w ?? 0;
  const grid = system.grid_w ?? 0; // + import, - export
  const bat = system.bat_w ?? 0; // + charging, - discharging
  const soc = system.soc;

  const hasSolar = pv > ACTIVE_W;
  const hasLoad = load > ACTIVE_W;
  const gridImport = grid > ACTIVE_W;
  const gridExport = grid < -ACTIVE_W;
  const charging = bat > ACTIVE_W;
  const discharging = bat < -ACTIVE_W;

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-20 transition-opacity duration-1000 dark:opacity-10">
        <div className={cn("absolute -top-1/2 left-1/4 h-full w-1/2 bg-yellow-400/30 blur-[100px] transition-all duration-1000", hasSolar ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
        <div className={cn("absolute -bottom-1/2 right-1/4 h-full w-1/2 bg-cyan-400/30 blur-[100px] transition-all duration-1000", hasLoad ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
        <div className={cn("absolute -left-1/4 top-1/4 h-1/2 w-1/2 bg-blue-500/30 blur-[100px] transition-all duration-1000", gridImport ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
      </div>
      <CardHeader className="relative pb-0">
        <CardTitle className="text-base">{t(`system.${system.system}`)}</CardTitle>
        {system.zones.length > 1 && <p className="text-xs text-muted-foreground">{system.zones.map(z => t(`zone.${z}`)).join(" + ")}</p>}
      </CardHeader>
      <CardContent className="relative p-4 pb-10 sm:p-6 sm:pb-12">
        {/* dir=ltr: the diagram's geometry is fixed (grid left, home right) in both languages */}
        <div className="relative aspect-video w-full" dir="ltr">
          <svg viewBox="0 0 400 225" className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
            <FlowPath active={hasSolar && hasLoad} d="M200,56 C200,80 340,80 340,113" color="text-yellow-500" />
            <FlowPath active={hasSolar && charging} d="M200,56 L200,191" color="text-yellow-500" />
            <FlowPath active={hasSolar && gridExport} d="M200,56 C200,80 60,80 60,113" color="text-yellow-500" />
            {/* Grid import feeds the house when solar can't cover it, and/or charges the battery. */}
            <FlowPath active={gridImport && (load > pv || !charging)} d="M60,113 L340,113" color="text-blue-500" dashed />
            <FlowPath active={gridImport && charging} d="M60,113 C60,153 200,153 200,191" color="text-blue-500" />
            <FlowPath active={discharging && hasLoad} d="M200,191 C200,153 340,153 340,113" color="text-pink-500" />
          </svg>

          <div className="pointer-events-none absolute inset-0">
            <NodeAt className="left-1/2 top-[25%]">
              <EnergyNode icon={Sun} value={pv} active={hasSolar} tone="yellow" label={t("power.solar")} />
            </NodeAt>
            <NodeAt className="left-[15%] top-1/2">
              <EnergyNode
                icon={Zap}
                value={Math.abs(grid)}
                active={gridImport || gridExport}
                tone={gridExport ? "green" : "blue"}
                label={t("power.grid")}
                subLabel={gridExport ? t("flow.export") : gridImport ? t("flow.import") : undefined}
              >
                {system.grid_available !== null && (
                  <div
                    className={cn(
                      "absolute -right-3 -top-3 z-30 rounded-full border bg-background/90 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider shadow-sm",
                      system.grid_available ? "border-green-500/20 text-green-600" : "border-red-500/20 text-red-600",
                    )}
                  >
                    {system.grid_available ? t("flow.on") : t("flow.off")}
                  </div>
                )}
              </EnergyNode>
            </NodeAt>
            <NodeAt className="left-[85%] top-1/2">
              <EnergyNode icon={HomeIcon} value={load} active={hasLoad} tone="cyan" label={t("power.load")} />
            </NodeAt>
            <NodeAt className="left-1/2 top-[85%]">
              <EnergyNode
                icon={Battery}
                value={Math.abs(bat)}
                active={charging || discharging}
                tone={charging ? "green" : "pink"}
                label={t("power.battery")}
                subLabel={charging ? t("battery.charging") : discharging ? t("battery.discharging") : undefined}
              >
                {soc !== null && (
                  <div
                    className="absolute -right-2 -top-1 z-30 rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white shadow-md ring-2 ring-background sm:text-[11px]"
                    style={{ backgroundColor: batteryColor(soc) }}
                  >
                    {Math.round(soc)}%
                  </div>
                )}
              </EnergyNode>
            </NodeAt>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NodeAt({ className, children }: { className: string; children: ReactNode }) {
  return <div className={cn("absolute h-0 w-0 -translate-x-1/2 -translate-y-1/2", className)}>{children}</div>;
}

function FlowPath({ d, color, active, dashed }: { d: string; color: string; active: boolean; dashed?: boolean }) {
  if (!active) return <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/10" />;
  return (
    <>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="4" className={cn(color, "opacity-20 blur-[2px]")} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className={cn(color, "animate-energy-flow")} strokeDasharray={dashed ? "5 5" : "10 10"} strokeLinecap="round" />
    </>
  );
}

const TONES = {
  yellow: { text: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500" },
  blue: { text: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500" },
  green: { text: "text-green-500", bg: "bg-green-500/10", border: "border-green-500" },
  cyan: { text: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500" },
  pink: { text: "text-pink-500", bg: "bg-pink-500/10", border: "border-pink-500" },
} as const;

interface EnergyNodeProps {
  icon: LucideIcon;
  value: number;
  active: boolean;
  tone: keyof typeof TONES;
  label: string;
  subLabel?: string;
  children?: ReactNode;
}

function EnergyNode({ icon: Icon, value, active, tone, label, subLabel, children }: EnergyNodeProps) {
  const c = TONES[tone];
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative flex h-0 w-0 items-center justify-center">
        <div className="pointer-events-auto absolute flex items-center justify-center" title={label}>
          <div className={cn("relative flex items-center justify-center rounded-full border-2 p-3 transition-all duration-500", active ? `${c.border} shadow-lg` : "border-muted")}>
            <div className="absolute inset-0 rounded-full bg-card" />
            <div className={cn("absolute inset-0 rounded-full transition-colors duration-500", active ? c.bg : "bg-muted/10")} />
            {active && <div className={cn("absolute inset-0 animate-pulse-ring rounded-full", c.bg)} />}
            <Icon className={cn("relative z-10 h-6 w-6 transition-colors duration-500", active ? c.text : "text-muted-foreground")} />
            {children}
          </div>
        </div>
        <div className="pointer-events-auto absolute left-1/2 top-[32px] z-20 -translate-x-1/2 whitespace-nowrap text-center">
          <div className="inline-block rounded-full border bg-card/90 px-2.5 py-1 shadow-sm backdrop-blur-md">
            <div className={cn("font-mono text-sm font-bold leading-none transition-colors duration-500", active ? "text-foreground" : "text-muted-foreground")}>
              {formatPower(value)}
            </div>
          </div>
          {subLabel && (
            <div className="mt-1">
              <span className="rounded bg-card/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider opacity-70">{subLabel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(EnergyFlowCard);
