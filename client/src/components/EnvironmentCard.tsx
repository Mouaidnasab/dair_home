import { Leaf, CloudRain, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

interface EnvironmentCardProps {
  environment: {
    co2Reduced: number;
    treesSaved: number;
    coalSaved: number;
  };
}

export default function EnvironmentCard({ environment }: EnvironmentCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="col-span-full md:col-span-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-green-500" />
          {t("environment.title", "Environmental Benefits")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="flex items-center gap-4 rounded-lg border p-4">
            <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
              <CloudRain className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("environment.co2_reduced", "CO2 Reduced")}
              </p>
              <p className="text-2xl font-bold">
                {environment.co2Reduced.toLocaleString()}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {t("kg")}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-lg border p-4">
            <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/20">
              <Leaf className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("environment.trees_saved", "Trees Planted")}
              </p>
              <p className="text-2xl font-bold">
                {environment.treesSaved.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-lg border p-4">
            <div className="rounded-full bg-slate-100 p-3 dark:bg-slate-900/20">
              <Flame className="h-6 w-6 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("environment.coal_saved", "Coal Saved")}
              </p>
              <p className="text-2xl font-bold">
                {environment.coalSaved.toLocaleString()}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {t("kg")}
                </span>
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
