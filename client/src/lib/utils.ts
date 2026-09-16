import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const HOME_TZ = "Asia/Damascus";

/** YYYY-MM-DD for "now" (or a unix time) in the home's timezone, independent of the browser's. */
export function localDay(ts?: number): string {
  const d = ts === undefined ? new Date() : new Date(ts * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(day: string, months: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function formatClock(ts: number, lang: string): string {
  return new Date(ts * 1000).toLocaleTimeString(lang, { timeZone: HOME_TZ, hour: "2-digit", minute: "2-digit" });
}

export function formatPower(watts: number | null | undefined): string {
  if (watts === null || watts === undefined || Number.isNaN(watts)) return "—";
  const abs = Math.abs(watts);
  return abs >= 1000 ? `${(watts / 1000).toFixed(abs >= 10000 ? 0 : 1)} kW` : `${Math.round(watts)} W`;
}

export function formatEnergy(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return "—";
  return kwh >= 100 ? `${Math.round(kwh)} kWh` : `${kwh.toFixed(kwh >= 10 ? 1 : 2)} kWh`;
}

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  const digits = currency === "USD" || currency === "SAR" ? 2 : 0;
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${currency}`;
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function socColor(soc: number | null | undefined): string {
  if (soc === null || soc === undefined) return "bg-muted-foreground";
  if (soc >= 60) return "bg-emerald-500";
  if (soc >= 30) return "bg-amber-500";
  return "bg-red-500";
}
