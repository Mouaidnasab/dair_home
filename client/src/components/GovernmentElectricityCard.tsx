import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/lib/utils";

interface ElectricityInterval {
  startTime: string;
  endTime: string;
  duration: number; // in minutes
}

interface GovernmentElectricityCardProps {
  intervals: ElectricityInterval[];
  totalHours: number;
  viewDate?: Date; // ← added from Home
}

export default function GovernmentElectricityCard({
  intervals,
  totalHours,
  viewDate,
}: GovernmentElectricityCardProps) {
  const { t } = useTranslation();

  const isToday = viewDate
    ? new Date().toDateString() === viewDate.toDateString()
    : true;

  const formattedDate = viewDate
    ? viewDate.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-4 flex items-start justify-between">
        <CardTitle>{t("government.title")}</CardTitle>

        {/* Date Badge */}
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {isToday ? t("common.today", "Today") : formattedDate}
        </span>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Total hours */}
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            {isToday ? t("government.today") : t("government.viewing_day")}
          </div>
          <div className="text-3xl font-bold">{totalHours.toFixed(1)}h</div>
        </div>

        {/* Intervals list */}
        <div className="space-y-3 border-t border-border pt-4">
          <div className="text-sm font-semibold">
            {t("government.intervals")}
          </div>

          {intervals.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("government.no_intervals")}
            </div>
          ) : (
            <div className="space-y-2">
              {intervals.map((interval, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <div>
                      <div className="font-medium">
                        {formatTime(interval.startTime)} –{" "}
                        {formatTime(interval.endTime)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {interval.duration} {t("government.duration_min")}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
