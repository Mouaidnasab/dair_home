import { Sun, Zap, Plug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatPower,
  formatEnergy,
  getStatusColor,
} from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { InverterData } from "@/types/energy";

interface InverterPanelProps {
  title: string;
  data: InverterData;
  sparklineData?: Array<{ time: string; power: number }>;
}

export default function InverterPanel({
  title,
  data,
  sparklineData,
}: InverterPanelProps) {
  const { t } = useLanguage();
  const testId = title === "Ground Floor" ? "inverter-ground" : "inverter-first";

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${getStatusColor(data.status)}`}
            />
            {title}
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {data.ratedKwp} kWp
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Key Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Sun className="h-4 w-4" />
              {t("inverter.pv_now")}
            </div>
            <div className="text-2xl font-bold">{formatPower(data.pvNowW)}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">{t("inverter.today")}</div>
            <div className="text-2xl font-bold">{formatEnergy(data.todayKWh)}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Plug className="h-4 w-4" />
              {t("inverter.load")}
            </div>
            <div className="text-2xl font-bold">{formatPower(data.loadW)}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">{t("inverter.rated_power")}</div>
            <div className="text-lg font-semibold">{data.ratedKwp} kWp</div>
          </div>
        </div>

        {/* Device Info */}
        <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <div>{data.model}</div>
          <div>SN: {data.serialNumber}</div>
        </div>
      </CardContent>
    </Card>
  );
}

