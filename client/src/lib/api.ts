import type { CyclesResponse, EnergyResponse, LiveResponse, Period, SeriesResponse, ZoneOrHome } from "@/types/energy";

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const url = qs.size ? `${path}?${qs}` : path;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${path})`);
  return res.json() as Promise<T>;
}

export const api = {
  live: (signal?: AbortSignal) => get<LiveResponse>("/api/v1/live", {}, signal),
  series: (day: string, zone: ZoneOrHome, signal?: AbortSignal) =>
    get<SeriesResponse>("/api/v1/series", { day, zone }, signal),
  energy: (period: Period, date: string, zone: ZoneOrHome, currency: string, signal?: AbortSignal) =>
    get<EnergyResponse>("/api/v1/energy", { period, date, zone, currency }, signal),
  cycles: (zone: ZoneOrHome, currency: string, signal?: AbortSignal) =>
    get<CyclesResponse>("/api/v1/cycles", { zone, currency, limit: 6 }, signal),
};
