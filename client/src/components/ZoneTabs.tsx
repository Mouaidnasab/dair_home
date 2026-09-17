import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { ZoneOrHome } from "@/types/energy";

export const ZONES: ZoneOrHome[] = ["home", "ground", "first", "garden"];

export default function ZoneTabs({ value, onChange }: { value: ZoneOrHome; onChange: (z: ZoneOrHome) => void }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 text-xs">
      {ZONES.map(z => (
        <button
          key={z}
          onClick={() => onChange(z)}
          className={cn("whitespace-nowrap rounded-md px-2.5 py-1 font-medium", value === z ? "bg-background shadow-sm" : "text-muted-foreground")}
        >
          {t(`zone.${z}`)}
        </button>
      ))}
    </div>
  );
}
