import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StatProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  className?: string;
}

export default function Stat({ icon: Icon, label, value, hint, tone = "text-muted-foreground", className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-xl bg-muted/50 p-3", className)}>
      <Icon className={cn("h-5 w-5 shrink-0", tone)} />
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-bold leading-tight tabular-nums">{value}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}
