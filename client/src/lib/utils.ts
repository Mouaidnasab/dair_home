import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Format absolute time with timezone
 */
export function formatAbsoluteTime(
  date: Date | string,
  timezone?: string,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  let tzStr = "";
  if (timezone) {
    tzStr = ` (${timezone})`;
  }

  return `${dateStr} ${timeStr}${tzStr}`;
}

/**
 * Format power value (W → kW if >= 1000)
 */
export function formatPower(watts: number | undefined): string {
  if (watts === undefined || isNaN(watts)) return "N/A";
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`;
  }
  return `${Math.round(watts)} W`;
}

/**
 * Format energy value (kWh)
 */
export function formatEnergy(kwh: number): string {
  if (kwh >= 100) {
    return `${Math.round(kwh)} kWh`;
  }
  return `${kwh.toFixed(2)} kWh`;
}

/**
 * Format currency with proper locale
 */
export function formatCurrency(amount: number, currency: string): string {
  // For SYP related currencies, just show the amount with currency code
  if (currency === "SYP" || currency === "NEW SYP") {
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  });
  return formatter.format(amount);
}

/**
 * Get color for estimated cost based on currency thresholds
 * 0 is green, 100% threshold is red
 */
export function getCostColor(val: number, currency: string): string {
  if (val <= 0) return "rgb(34, 197, 94)"; // green-500

  let threshold = 10000; // default SYP
  if (currency === "NEW SYP") threshold = 100;
  if (currency === "USD") threshold = 1;
  if (currency === "SAR") threshold = 4;

  const ratio = Math.min(val / threshold, 1);

  // Interpolate between Green (34, 197, 94) and Red (239, 68, 68)
  const r = Math.round(34 + ratio * (239 - 34));
  const g = Math.round(197 + ratio * (68 - 197));
  const b = Math.round(94 + ratio * (68 - 94));

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Calculate estimated runtime in hours
 */
export function calculateEstimatedRuntime(
  socPercent: number,
  loadW: number,
  batteryCapacityWh: number = 10000,
): number {
  loadW = loadW * -1;
  if (loadW <= 0) return Infinity;
  const energyAvailableWh = (socPercent / 100) * batteryCapacityWh;
  return energyAvailableWh / loadW;
}

/**
 * Get color for battery SOC percentage
 */
export function getBatteryColor(soc: number): string {
  // Red (239, 68, 68) -> Yellow (234, 179, 8) -> Green (34, 197, 94)
  if (soc <= 20) {
    const ratio = soc / 20;
    const r = Math.round(239 + ratio * (234 - 239));
    const g = Math.round(68 + ratio * (179 - 68));
    const b = Math.round(68 + ratio * (8 - 68));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const ratio = Math.min((soc - 20) / 80, 1);
    const r = Math.round(234 + ratio * (34 - 234));
    const g = Math.round(179 + ratio * (197 - 179));
    const b = Math.round(8 + ratio * (94 - 8));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Format runtime as human-readable string
 */
export function formatRuntime(hours: number): string {
  if (!isFinite(hours)) return "∞";
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

/**
 * Get status color for display
 */
export function getStatusColor(status: "normal" | "warning" | "fault"): string {
  switch (status) {
    case "normal":
      return "bg-green-500";
    case "warning":
      return "bg-yellow-500";
    case "fault":
      return "bg-red-500";
  }
}

/**
 * Get battery state color
 */
export function getBatteryStateColor(
  state: "idle" | "charging" | "discharging",
): string {
  switch (state) {
    case "charging":
      return "text-green-600 dark:text-green-400";
    case "discharging":
      return "text-orange-600 dark:text-orange-400";
    case "idle":
      return "text-gray-600 dark:text-gray-400";
  }
}

/**
 * Get battery state label
 */
export function getBatteryStateLabel(
  state: "idle" | "charging" | "discharging",
): string {
  switch (state) {
    case "charging":
      return "Charging";
    case "discharging":
      return "Discharging";
    case "idle":
      return "Idle";
  }
}

/**
 * Format time as HH:MM
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
