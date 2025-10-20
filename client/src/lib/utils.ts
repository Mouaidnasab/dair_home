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
export function formatAbsoluteTime(date: Date | string, timezone?: string): string {
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
export function formatPower(watts: number): string {
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
  // For SYP, just show the amount with currency code
  if (currency === "SYP") {
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
 * Calculate estimated runtime in hours
 */
export function calculateEstimatedRuntime(
  socPercent: number,
  loadW: number,
  batteryCapacityWh: number = 10000
): number {
  if (loadW <= 0) return Infinity;
  const energyAvailableWh = (socPercent / 100) * batteryCapacityWh;
  return energyAvailableWh / loadW;
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
export function getBatteryStateColor(state: "idle" | "charging" | "discharging"): string {
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
export function getBatteryStateLabel(state: "idle" | "charging" | "discharging"): string {
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
    hour12: false,
  });
}

